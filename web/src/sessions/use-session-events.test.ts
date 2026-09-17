// The SSE stream allowlist, proven type by type. It existed in TWO copies from #43 to 28/08 (here
// and in the task page) with no test comparing them. Only one remains, and this test walks THAT one.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_EVENT_TYPES, useSessionEvents } from "./use-session-events.js";

/** A paper EventSource: it keeps its listeners, and the test pushes lines to it. jsdom provides
 *  none, and a real one would open a connection. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  /** The last one opened, the one the hook just built. */
  static last: FakeEventSource | undefined;
  readyState = FakeEventSource.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  /** What the browser would do on receiving an `event: <type>` line. */
  emit(type: string, data: unknown, id?: string) {
    const e = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id });
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

describe("useSessionEvents: the allowlist", () => {
  it("passes every listed type, in order, and notifies the caller for each", () => {
    const seen: string[] = [];
    const { result } = renderHook(() => useSessionEvents("s-1", (t) => seen.push(t)));
    const es = FakeEventSource.last!;
    act(() => {
      SESSION_EVENT_TYPES.forEach((t, i) => es.emit(t, { n: i }, String(i + 1)));
    });
    expect(result.current.events.map((e) => e.type)).toEqual([...SESSION_EVENT_TYPES]);
    expect(seen).toEqual([...SESSION_EVENT_TYPES]);
  });

  it("an unlisted type reaches the browser and is never displayed", () => {
    const { result } = renderHook(() => useSessionEvents("s-1"));
    const es = FakeEventSource.last!;
    act(() => {
      es.emit("pause_requested", {}, "1");
      es.emit("text", { text: "ok" }, "2");
      es.emit("not_a_type", {}, "3");
    });
    expect(result.current.events.map((e) => e.type)).toEqual(["text"]);
  });

  // The copy below is DELIBERATE and the only one allowed: it fails an accidental removal, which
  // walking the exported list would not see.
  it("the list is exactly this one", () => {
    expect([...SESSION_EVENT_TYPES]).toEqual([
      "status",
      "init",
      "tool_start",
      "tool_end",
      "text",
      "activity",
      "task_status",
      "result",
      "run_error",
      "run_warning",
      "inbox_ask",
      "inbox_answer",
      "inbox_note",
      "fs_op",
      "fs_denied",
      "throttle",
      "repo_ready",
      "repo_push",
      "repo_push_failed",
      "capabilities",
      "steer",
      "steer_delivered",
      "dependency_wait",
      "dependency_resolved",
    ]);
  });
});

describe("useSessionEvents: what the task page used to do by hand", () => {
  it("closes BY ITSELF on `stream_end`, and `reconnect` opens a fresh stream", () => {
    const { result } = renderHook(() => useSessionEvents("s-1"));
    const first = FakeEventSource.last!;
    act(() => {
      first.emit("stream_end", {});
    });
    expect(first.closed).toBe(true);
    expect(result.current.stream).toBe("live");
    act(() => {
      result.current.reconnect();
    });
    expect(FakeEventSource.last).not.toBe(first);
    expect(FakeEventSource.last!.url).toBe("/api/sessions/s-1/live");
  });

  it("dedups on the SSE id: a line replayed after a cut shows once", () => {
    const { result } = renderHook(() => useSessionEvents("s-1"));
    const es = FakeEventSource.last!;
    act(() => {
      es.emit("text", { text: "a" }, "7");
      es.emit("text", { text: "a" }, "7");
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.dbId).toBe(7);
  });
});
