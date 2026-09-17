// The stream seen from the screen: an event arrives, the right key is invalidated. The half no
// server test can prove: the server knows it pushed a line, not whether anyone used it. Four
// properties: translation (the right type wakes the right key), coalescing (a burst does not become
// a burst of requests), backoff (a stopped server is not hammered) and recovery (on return,
// everything is refetched, since what was missed is unknown).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COALESCE_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  useControlEvents,
} from "./use-control-events.js";
import { qk } from "../queries.js";

/** A paper `EventSource`, same pattern as `sessions/use-session-events.test.ts`: jsdom provides
 *  none, and a real one would open a connection. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  /** Every instance opened since the test started: what makes the backoff visible. */
  static opened: FakeEventSource[] = [];
  static get last(): FakeEventSource {
    return FakeEventSource.opened[FakeEventSource.opened.length - 1]!;
  }
  readyState = FakeEventSource.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.opened.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  open() {
    this.onopen?.();
  }
  fail() {
    this.onerror?.();
  }
}

let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useControlEvents(), { wrapper });
}

/** Keys invalidated so far, in order. `undefined` = "the whole cache". */
const invalidated = () =>
  invalidate.mock.calls.map(
    (call: unknown[]) => (call[0] as { queryKey?: unknown } | undefined)?.queryKey,
  );

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.opened = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  client = new QueryClient();
  invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("an event invalidates the right key", () => {
  it("opens ONE stream, on the server route", () => {
    mount();
    expect(FakeEventSource.opened).toHaveLength(1);
    expect(FakeEventSource.last.url).toBe("/api/events");
  });

  it("`task_status` wakes tasks and the project's goals", () => {
    mount();
    FakeEventSource.last.emit({
      type: "task_status",
      sessionId: "s-1",
      taskId: "t-1",
      projectId: "p-1",
    });
    // NOTHING left yet: the coalescing window has not elapsed.
    expect(invalidated()).toEqual([]);
    vi.advanceTimersByTime(COALESCE_MS);
    expect(invalidated()).toEqual([qk.tasks, qk.goals("p-1")]);
  });

  it("`fs_op` wakes its task's artifacts, not the task list", () => {
    mount();
    FakeEventSource.last.emit({ type: "fs_op", sessionId: "s-1", taskId: "t-1" });
    vi.advanceTimersByTime(COALESCE_MS);
    expect(invalidated()).toEqual([qk.artifacts("t-1")]);
  });

  it("a type the screen does not know triggers nothing", () => {
    mount();
    FakeEventSource.last.emit({ type: "text", sessionId: "s-1" });
    FakeEventSource.last.emit({ type: "tool_start", sessionId: "s-1" });
    vi.advanceTimersByTime(COALESCE_MS * 5);
    expect(invalidated()).toEqual([]);
  });

  it("a burst refetches each list only once", () => {
    mount();
    for (let i = 0; i < 10; i++)
      FakeEventSource.last.emit({ type: "fs_op", sessionId: "s-1", taskId: "t-1" });
    FakeEventSource.last.emit({ type: "task_status", sessionId: "s-1", taskId: "t-1" });
    vi.advanceTimersByTime(COALESCE_MS);
    expect(invalidated()).toEqual([qk.artifacts("t-1"), qk.tasks]);
  });
});

describe("the cut and the return", () => {
  it("retries later and later, up to a cap", () => {
    mount();
    // Three cuts in a row: 1 s, 2 s, 4 s. The browser would retry every 3 s forever, 1,200 requests
    // an hour on a server stopped for the night.
    for (const delay of [RETRY_BASE_MS, RETRY_BASE_MS * 2, RETRY_BASE_MS * 4]) {
      const before = FakeEventSource.opened.length;
      FakeEventSource.last.fail();
      expect(FakeEventSource.last.closed).toBe(true);
      vi.advanceTimersByTime(delay - 1);
      expect(FakeEventSource.opened).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeEventSource.opened).toHaveLength(before + 1);
    }
  });

  it("the backoff is BOUNDED: never later than the cap", () => {
    mount();
    for (let i = 0; i < 20; i++) {
      FakeEventSource.last.fail();
      vi.advanceTimersByTime(RETRY_MAX_MS);
    }
    const before = FakeEventSource.opened.length;
    FakeEventSource.last.fail();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(FakeEventSource.opened).toHaveLength(before + 1);
  });

  it("on RECONNECTION everything is invalidated: what was missed is unknown", () => {
    mount();
    // First opening: nothing invalidated, the page queries run anyway.
    FakeEventSource.last.open();
    expect(invalidated()).toEqual([]);
    FakeEventSource.last.fail();
    vi.advanceTimersByTime(RETRY_BASE_MS);
    FakeEventSource.last.open();
    expect(invalidated()).toEqual([undefined]);
  });

  it("unmounted, it closes its stream and never reopens", () => {
    const view = mount();
    const first = FakeEventSource.last;
    view.unmount();
    expect(first.closed).toBe(true);
    first.fail();
    vi.advanceTimersByTime(RETRY_MAX_MS * 2);
    expect(FakeEventSource.opened).toHaveLength(1);
  });
});
