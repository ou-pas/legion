// The facts a session establishes, which the verdict turns into sentences. Three of them decide what
// the operator believes: the "currently" tool (a tool_start never closed), what was REALLY pushed (a
// zero-change push is not a push), and the end reason when the column is empty and only the stream
// carries it.
import { describe, expect, it } from "vitest";
import {
  elapsed,
  pendingSince,
  pendingTool,
  pushedRepos,
  runsOf,
  sessionOutcome,
  workMs,
} from "./session-facts.js";

describe("elapsed", () => {
  it("counts seconds under a minute", () => {
    expect(elapsed(0)).toBe("0 s");
    expect(elapsed(45_000)).toBe("45 s");
  });

  it("moves to minutes, then hours and minutes", () => {
    expect(elapsed(60_000)).toBe("1 min");
    expect(elapsed(59 * 60_000)).toBe("59 min");
    expect(elapsed(3_600_000)).toBe("1 h 00");
    expect(elapsed(3_600_000 + 7 * 60_000)).toBe("1 h 07");
  });

  it("never shows a negative duration: a clock going backwards is not a fact", () => {
    expect(elapsed(-5000)).toBe("0 s");
  });
});

describe("pendingTool", () => {
  const start = (tool: string, ts?: number) => ({ type: "tool_start", data: { tool, ts } });
  const end = { type: "tool_end", data: {} };

  it("returns the tool_start its tool_end did not close", () => {
    expect(pendingTool([start("Read"), end, start("Bash")])?.data.tool).toBe("Bash");
  });

  it("returns null when everything is closed: the agent is thinking, not broken", () => {
    expect(pendingTool([start("Read"), end])).toBeNull();
    expect(pendingTool([])).toBeNull();
  });

  it('dates the "since" line on the running tool, else on the session start', () => {
    const session = { startedAt: "2026-08-28T10:00:00.000Z" };
    expect(pendingSince(pendingTool([start("Bash", 1234)]), session)).toBe(1234);
    expect(pendingSince(null, session)).toBe(Date.parse(session.startedAt));
  });
});

describe("pushedRepos", () => {
  const push = (repo: string, changes: number, commit: string) => ({
    type: "repo_push",
    data: { repo, changes, commit },
  });

  it("ignores a zero-change push: nothing happened on that branch", () => {
    expect(pushedRepos([push("web", 0, "abc")])).toEqual([]);
  });

  it("keeps a repo's last push: the same work, pushed twice", () => {
    expect(pushedRepos([push("web", 3, "aaa"), push("web", 5, "bbb")])).toEqual([
      { repo: "web", changes: 5, commit: "bbb" },
    ]);
  });

  it("one line per repo", () => {
    expect(pushedRepos([push("web", 1, "a"), push("server", 2, "b")]).map((p) => p.repo)).toEqual([
      "web",
      "server",
    ]);
  });
});

describe("sessionOutcome", () => {
  it("success comes from the last `result`", () => {
    const events = [{ type: "result", data: { subtype: "success", numTurns: 12 } }];
    const o = sessionOutcome({ endReason: null }, events);
    expect(o.succeeded).toBe(true);
    expect(o.numTurns).toBe(12);
  });

  it("the `endReason` column wins over the status event", () => {
    const events = [{ type: "status", data: { reason: "seen in the stream" } }];
    expect(sessionOutcome({ endReason: "seen in the column" }, events).endReason).toBe(
      "seen in the column",
    );
  });

  it("without a column the reason comes from the stream: sessions before v22 depend on it", () => {
    const events = [{ type: "status", data: { reason: "token budget exhausted" } }];
    expect(sessionOutcome({ endReason: null }, events).endReason).toBe("token budget exhausted");
  });

  it("returns the LAST run_error, and nothing when there is none", () => {
    const events = [
      { type: "run_error", data: { message: "first" } },
      { type: "run_error", data: { message: "last" } },
    ];
    expect(sessionOutcome({ endReason: null }, events).runError?.data.message).toBe("last");
    expect(sessionOutcome({ endReason: null }, []).runError).toBeNull();
  });

  it("does not consume the list it is given", () => {
    const events = [
      { type: "result", data: { subtype: "success" } },
      { type: "text", data: {} },
    ];
    sessionOutcome({ endReason: null }, events);
    expect(events.map((e) => e.type)).toEqual(["result", "text"]);
  });
});

describe("runsOf", () => {
  // The three runs of session `RPXUHq0upSK-`, measured on 10/09: the case the session row could not
  // tell, since it kept only the last.
  const three = [
    { type: "init", data: {} },
    { type: "result", data: { subtype: "success", costUsd: 0.941514, numTurns: 2 } },
    { type: "text", data: {} },
    { type: "result", data: { subtype: "success", costUsd: 0, numTurns: 1, isError: true } },
    { type: "result", data: { subtype: "success", costUsd: 3.4044492, numTurns: 44 } },
  ];

  it("returns one run per `result`, numbered in order", () => {
    expect(runsOf(three).map((r) => [r.index, r.costUsd])).toEqual([
      [1, 0.941514],
      [2, 0],
      [3, 3.4044492],
    ]);
  });

  it("sums what the session row overwrote", () => {
    expect(runsOf(three).reduce((sum, r) => sum + r.costUsd, 0)).toBeCloseTo(4.3459632, 7);
  });

  it("a `success` with `isError` is a FAILURE: the subtype lies, not the flag", () => {
    expect(runsOf(three).map((r) => r.failed)).toEqual([false, true, false]);
  });

  it("a trace from before per-run duration returns `null`, not zero", () => {
    expect(runsOf(three)[0]!.durationMs).toBeNull();
    const withDuration = [{ type: "result", data: { subtype: "success", durationMs: 92_000 } }];
    expect(runsOf(withDuration)[0]!.durationMs).toBe(92_000);
  });

  it("no session, no run", () => {
    expect(runsOf([])).toEqual([]);
  });
});

describe("workMs", () => {
  const runs = [
    { type: "result", data: { subtype: "success", durationMs: 112_000, durationApiMs: 98_000 } },
    { type: "result", data: { subtype: "success", durationMs: 3200, durationApiMs: 3000 } },
  ];

  it("sums the runs' work, and its model share apart", () => {
    expect(workMs(runsOf(runs))).toBe(115_200);
    expect(workMs(runsOf(runs), "api")).toBe(101_000);
  });

  it("returns `null` when no run carries its duration: zero would be a lie", () => {
    // A trace from before 10/09: the runtime did not record duration. "Work: 0 s" would suggest an
    // instant session, when we simply do not know.
    expect(workMs(runsOf([{ type: "result", data: { subtype: "success" } }]))).toBeNull();
    expect(workMs([])).toBeNull();
  });

  it("sums what it knows when a single trace is silent", () => {
    const mixte = [...runs, { type: "result", data: { subtype: "success" } }];
    expect(workMs(runsOf(mixte))).toBe(115_200);
  });
});
