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
