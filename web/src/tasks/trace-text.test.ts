// The trace as plain text: what goes to the clipboard and gets reread months later, pasted into a
// ticket. The only output of the project whose regression nobody sees: neither on screen nor in an
// API response.
import { describe, expect, it } from "vitest";
import { fmtTime, plain, traceText } from "./trace-text.js";

describe("fmtTime", () => {
  it("returns an empty string without a timestamp, better than an invented today's date", () => {
    expect(fmtTime({ type: "text", data: {} })).toBe("");
    expect(fmtTime({ type: "text", data: { ts: "not a number" } })).toBe("");
  });
});

describe("plain", () => {
  it("tells an AUTOMATIC wake-up from a real human answer", () => {
    // Writing "human answer" on a system wake-up would be false: nobody answered.
    expect(plain({ type: "inbox_answer", data: { answeredBy: "system", answer: "ok" } })).toBe(
      "automatic wake-up: ok",
    );
    expect(plain({ type: "inbox_answer", data: { answeredBy: "human", answer: "ok" } })).toBe(
      "human answer: ok",
    );
  });

  // A trace pasted into a ticket must say WHY a tool was refused. Before 08/09 it wrote "done" on a
  // failure, and the reason was captured nowhere.
  it('writes "failed" and its reason rather than "done" on a refused tool', () => {
    expect(plain({ type: "tool_end", data: { ok: false, error: "Permission denied" } })).toBe(
      "failed — Permission denied",
    );
    expect(plain({ type: "tool_end", data: { ok: false } })).toBe("failed");
    expect(plain({ type: "tool_end", data: { ok: true, durationMs: 12 } })).toBe("done · 12ms");
  });

  // 10/09: "done" alone lied on a `pnpm test` moved to the background after its two minutes. The
  // runner now keeps the harness notice when short, and a pasted trace must carry it too.
  it("carries the harness notice on a success, when there is one", () => {
    expect(
      plain({
        type: "tool_end",
        data: { ok: true, durationMs: 120_003, result: "moved to the background (ID: bmf0xr40p)" },
      }),
    ).toBe("done · 120003ms · moved to the background (ID: bmf0xr40p)");
    expect(plain({ type: "tool_end", data: { ok: false, error: "denied", result: "x" } })).toBe(
      "failed — denied",
    );
  });

  it('says "nothing to push" rather than announcing an empty push', () => {
    expect(plain({ type: "repo_push", data: { repo: "web", changes: 0 } })).toBe(
      "push web · nothing to push",
    );
    expect(plain({ type: "repo_push", data: { repo: "web", changes: 4, commit: "a1b2c3" } })).toBe(
      "push web · 4 file(s) · a1b2c3",
    );
  });

  it("names subscription auth, which the runner signals by the absence of a key", () => {
    expect(plain({ type: "init", data: { model: "opus", apiKeySource: "none" } })).toBe(
      "init · opus · auth: oauth (subscription)",
    );
  });

  it("spells out a refused push", () => {
    expect(
      plain({
        type: "repo_push_failed",
        data: { repo: "web", branch: "legion/t1", error: "403" },
      }),
    ).toBe("push FAILED web (legion/t1) : 403");
  });

  // Inertia pause (10/09): the session was progressing and restarts on its own. The trace must give
  // the resume number, the turn and what was produced, not the raw JSON payload.
  it("writes the automatic relaunch as one sentence rather than the raw payload", () => {
    expect(
      plain({
        type: "turn_relaunch",
        data: {
          used: 175,
          pauseAt: 175,
          cap: 200,
          resume: 3,
          idleTurns: 2,
          sinceTurn: 173,
          commits: 6,
          writes: 48,
          lastCommitTurn: 173,
          writable: true,
        },
      }),
    ).toBe("automatic restart no. 3 at turn 175 — 6 commit(s), 48 write(s)");
  });

  it("says there is no writable repo on a relaunch where no commit is possible", () => {
    expect(
      plain({
        type: "turn_relaunch",
        data: {
          used: 175,
          pauseAt: 175,
          cap: 200,
          resume: 1,
          idleTurns: 0,
          sinceTurn: 175,
          commits: 0,
          writes: 12,
          lastCommitTurn: null,
          writable: false,
        },
      }),
    ).toBe(
      "automatic restart no. 1 at turn 175 — 0 commit(s), 12 write(s), no writable repository",
    );
  });

  it("tells apart the two ends of a dependency wait", () => {
    expect(plain({ type: "dependency_resolved", data: { reason: "deleted" } })).toBe(
      "wait lifted — the awaited task was deleted",
    );
    expect(plain({ type: "dependency_resolved", data: {} })).toBe(
      "wait lifted — the awaited task is done",
    );
  });

  it("says the webhook merged, and tells it apart from a `done` set by the agent", () => {
    expect(plain({ type: "task_status", data: { status: "done" } })).toBe("task moved to done");
    expect(
      plain({
        type: "task_status",
        data: { status: "done", via: "webhook", url: "https://github.com/o/r/pull/1" },
      }),
    ).toBe("task moved to done · merged by webhook (https://github.com/o/r/pull/1)");
  });

  it("an unknown type keeps its payload: it falls back on raw JSON", () => {
    expect(plain({ type: "made_up", data: { a: 1 } })).toBe('{"a":1}');
  });
});

describe("traceText", () => {
  it("carries a header: a pasted trace without agent or model is unreadable", () => {
    const out = traceText({
      taskName: "Environments screen",
      agentName: "builder",
      sessionId: "s-1",
      model: "opus",
      status: "destroyed",
      events: [{ type: "text", data: { text: "fini" } }],
    });
    expect(out).toContain("# Trace Legion · Environments screen");
    expect(out).toContain("# agent: builder · session: s-1 · model: opus · status: destroyed");
    expect(out).toContain("[text] fini");
  });

  it('fills the gaps rather than writing "undefined"', () => {
    const out = traceText({ taskName: "T", events: [] });
    expect(out).toContain("# agent: ? · session: — · model: ? · status: ?");
    expect(out).not.toContain("undefined");
  });

  it("one line per event, in order", () => {
    const out = traceText({
      taskName: "T",
      events: [
        { type: "status", data: { status: "running" } },
        { type: "run_error", data: { message: "boum" } },
      ],
    });
    const lines = out
      .trim()
      .split("\n")
      .filter((l) => !l.startsWith("#") && l.length > 0);
    expect(lines).toEqual([" [status] session running", " [run_error] error: boum"]);
  });
});
