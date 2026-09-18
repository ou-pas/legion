// Times survive a reload (10/09). A reloaded trace showed NO TIME on almost every line: SSE folds
// `ts` into the payload (`server/src/sessions/routes.ts`), history returns it NEXT TO the payload,
// and `fmtTime` (tasks/trace-text.ts) only reads `data.ts`. Since history wins dedup on `dbId`, even
// the live session's events lost their time.
//
// Tested through the hook rather than a pure function because the fold only exists in the history
// mapping: it is the seam between the two sources that breaks.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fmtTime } from "../tasks/trace-text.js";
import { LOCALE } from "../ui/locale.js";
import { useTaskEvents } from "./use-task-events.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TS = Date.parse("2026-09-10T11:51:20.000Z");

function Probe() {
  // No `liveSessionId`: no EventSource opens, only history is tested.
  const { events } = useTaskEvents("t1", undefined);
  const first = events[0];
  return <output>{first ? `${fmtTime(first)}|${String(first.data.tool ?? "")}` : "empty"}</output>;
}

function Wrap({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("a task's thread", () => {
  it("dates history events, where `ts` arrives next to the payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              sessions: [],
              events: [
                { dbId: 1, sessionId: "s1", type: "tool_start", payload: { tool: "Bash" }, ts: TS },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        `${new Date(TS).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}|Bash`,
      ),
    );
  });
});

// Opening a task page fired 14 identical rounds of task/links/inbox/artifacts (18/09): the live SSE
// replays its session from the start, and every replayed `status`/`fs_op` reached the page's
// `onEvent` as if it had just happened, each one invalidating the task queries.
describe("the live stream only reports what history does not already hold", () => {
  const opened: FakeEventSource[] = [];

  class FakeEventSource {
    static readonly CLOSED = 2;
    readyState = 1;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private readonly listeners = new Map<string, (e: MessageEvent) => void>();
    constructor(readonly url: string) {
      opened.push(this);
    }
    addEventListener(type: string, fn: (e: MessageEvent) => void) {
      this.listeners.set(type, fn);
    }
    close() {}
    emit(type: string, dbId: number) {
      this.listeners.get(type)?.(new MessageEvent(type, { data: "{}", lastEventId: String(dbId) }));
    }
  }

  function stubServer(sessions: { id: string; endedAt: number | null }[]) {
    opened.length = 0;
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              sessions: sessions.map((s) => ({ ...s, status: "running", startedAt: TS })),
              events: [{ dbId: 7, sessionId: "s1", type: "status", payload: {}, ts: TS }],
            }),
            { headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
  }

  function Live({ onEvent }: { onEvent: (type: string) => void }) {
    const { events } = useTaskEvents("t1", "s1", onEvent);
    return <output>{events.length}</output>;
  }

  it("ignores a replayed event history already holds, reports a new one", async () => {
    stubServer([{ id: "s1", endedAt: null }]);
    const onEvent = vi.fn();
    render(
      <Wrap>
        <Live onEvent={onEvent} />
      </Wrap>,
    );
    await waitFor(() => expect(opened).toHaveLength(1));

    opened[0]?.emit("status", 7);
    expect(onEvent).not.toHaveBeenCalled();
    opened[0]?.emit("status", 8);
    expect(onEvent).toHaveBeenCalledExactlyOnceWith("status");
  });

  it("opens no stream on a session history already says has ended", async () => {
    stubServer([{ id: "s1", endedAt: TS }]);
    render(
      <Wrap>
        <Live onEvent={vi.fn()} />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1"));
    expect(opened).toHaveLength(0);
  });
});
