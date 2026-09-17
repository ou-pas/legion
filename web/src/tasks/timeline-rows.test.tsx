// The trace STRUCTURE, checkable without rendering a row: pairing a tool call with its end, the kind
// table, what folds. Pairing is the rule that matters: without it every tool takes two rows and a
// session of three hundred calls becomes six hundred.
import { describe, expect, it } from "vitest";
import { rows } from "./timeline-rows.js";

const start = (tool: string, ts?: number) => ({ type: "tool_start", data: { tool, ts } });
const end = (durationMs = 12) => ({ type: "tool_end", data: { durationMs } });
/** Today's traces carry an id on both sides; older ones do not. */
const startId = (tool: string, id: string, parent?: string) => ({
  type: "tool_start",
  data: { tool, id, ...(parent ? { parent } : {}) },
});
const endId = (id: string, data: Record<string, unknown> = {}) => ({
  type: "tool_end",
  data: { id, ...data },
});

describe("rows", () => {
  it("absorbs the tool_end right after its tool_start: one tool = ONE row", () => {
    const out = rows([start("Bash"), end(), start("Read"), end()]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.kind)).toEqual(["tool_start", "tool_start"]);
  });

  it("leaves its row to an orphan tool_end: an end without a start is still a fact", () => {
    const out = rows([end(), start("Bash")]);
    expect(out.map((r) => r.kind)).toEqual(["tool_end", "tool_start"]);
  });

  it("does not pair beyond the immediate neighbour without an id", () => {
    const out = rows([start("Bash"), { type: "text", data: {} }, end()]);
    expect(out).toHaveLength(3);
  });

  // 08/09: under a fan-out, position lies. Thirty-two subagents render their calls in the same
  // stream: one's start got closed by another's end, so a wrong duration and, once failures showed,
  // a red row on the wrong call.
  it("pairs by id, even across another thread's rows", () => {
    const out = rows([
      startId("Bash", "a"),
      startId("Read", "b"),
      endId("b", { ok: false, error: "denied" }),
      endId("a", { durationMs: 9 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.emphasis)).toEqual([undefined, "error"]);
  });

  it("does not render twice an end already absorbed by a distant call", () => {
    const out = rows([startId("Bash", "a"), { type: "text", data: {} }, endId("a")]);
    expect(out.map((r) => r.kind)).toEqual(["tool_start", "text"]);
  });

  it("leaves its row to an end whose call is not in the loaded slice", () => {
    expect(rows([endId("never-seen")]).map((r) => r.kind)).toEqual(["tool_end"]);
  });

  // The answer to "where do we store that a subagent is running": in the event, already persisted.
  // `parent` carries the `Agent` call that started it, and the row names its branch.
  it("names a subagent's branch after the Agent call description", () => {
    const out = rows([
      {
        type: "tool_start",
        data: {
          tool: "Agent",
          id: "p1",
          input: '{"description":"Translate copilot.json to German","subagent',
        },
      },
      startId("Read", "c1", "p1"),
    ]);
    expect(JSON.stringify(out[1]?.summary)).toContain("Translate copilot.json to German");
  });

  it('says "subagent" when the parent call is not in the loaded slice', () => {
    const out = rows([startId("Read", "c1", "p-absent")]);
    expect(JSON.stringify(out[0]?.summary)).toContain("sous-agent");
  });

  it('a type unknown to the drawing falls back on "status" rather than breaking the row', () => {
    expect(rows([{ type: "made_up", data: {} }])[0]?.kind).toBe("status");
  });

  it("borrows the closest parent's icon for orphan types", () => {
    expect(rows([{ type: "activity", data: {} }])[0]?.kind).toBe("text");
    expect(rows([{ type: "inbox_note", data: {} }])[0]?.kind).toBe("inbox_ask");
  });

  it("marks the refused push: neither fs_denied nor run_error need it, this one does", () => {
    expect(rows([{ type: "repo_push_failed", data: {} }])[0]?.emphasis).toBe("error");
    expect(rows([{ type: "repo_push", data: {} }])[0]?.emphasis).toBeUndefined();
  });

  // 08/09: a refused tool looked exactly like a successful one. The `tool_end` is absorbed by the call
  // it ends, its row said "done" in both cases, so the failure left no mark. A session can die on two
  // refused `Bash` calls: the row must be red, paired or not.
  it("marks as error the call whose end failed, even absorbed into its row", () => {
    const ko = { type: "tool_end", data: { ok: false, error: "denied" } };
    expect(rows([start("Bash"), ko])[0]?.emphasis).toBe("error");
    expect(rows([ko])[0]?.emphasis).toBe("error");
    expect(rows([start("Bash"), end()])[0]?.emphasis).toBeUndefined();
  });

  // 10/09: "done" lied for two minutes. `pnpm -s test` closed at exactly 120 s: the suite was not
  // finished, it had moved to the background, and the row read the same as a passing suite. The
  // runner now keeps the harness notice when short; the row must carry it.
  it("carries a success notice in the row of the call it closes", () => {
    const notice = "moved to the background (ID: bmf0xr40p)";
    const out = rows([startId("Bash", "tu_1"), endId("tu_1", { ok: true, result: notice })]);
    expect(out).toHaveLength(1);
    expect(JSON.stringify(out[0]?.summary)).toContain(notice);
    expect(out[0]?.emphasis).toBeUndefined();
  });

  it("only folds what carries a structure: a sentence is already whole on its row", () => {
    expect(rows([{ type: "text", data: { text: "coucou" } }])[0]?.detail).toBeUndefined();
    expect(rows([{ type: "inbox_ask", data: { body: "?" } }])[0]?.detail).toBeUndefined();
    expect(rows([{ type: "result", data: { subtype: "success" } }])[0]?.detail).toBeDefined();
  });

  it("does not invent a date when the event carries none", () => {
    expect(rows([start("Bash")])[0]?.dateTime).toBeUndefined();
    expect(rows([start("Bash", Date.UTC(2026, 7, 28, 9, 0, 0))])[0]?.dateTime).toBe(
      "2026-08-28T09:00:00.000Z",
    );
  });

  // Inertia pause (10/09): an automatic relaunch has its own icon (not an orphan), and its full measure
  // stays in the fold; the summary only keeps the sentence.
  it("renders the automatic relaunch with its measure in the fold, not as JSON in the summary", () => {
    const out = rows([
      {
        type: "turn_relaunch",
        data: { used: 175, resume: 3, commits: 6, writes: 48, writable: true },
      },
    ]);
    expect(out[0]?.kind).toBe("turn_relaunch");
    expect(out[0]?.detail).toBeDefined();
    expect(JSON.stringify(out[0]?.summary)).toContain("automatic restart");
    expect(JSON.stringify(out[0]?.summary)).not.toContain('"used":175');
  });

  // The defect of 16/09: a type the table did not know dumped its payload on the row. Ten
  // `inbox_draft` in a row showed `{"inboxId":"zxcb_IF2-B","answered":2,…}` instead of a sentence.
  // That type no longer gets stored, but the fallback holds for every type forgotten later.
  it("an unknown type says its name, it does not dump its bytes", () => {
    const out = rows([{ type: "sait_pas", data: { inboxId: "zxcb_IF2-B", answered: 2 } }]);
    expect(JSON.stringify(out[0]?.summary)).toContain("sait_pas");
    expect(JSON.stringify(out[0]?.summary)).not.toContain("zxcb_IF2-B");
  });

  it("and its payload stays in the fold, the only place it is still readable", () => {
    const out = rows([{ type: "sait_pas", data: { inboxId: "zxcb_IF2-B" } }]);
    expect(out[0]?.detail).toBeDefined();
    expect(JSON.stringify(out[0]?.detail)).toContain("zxcb_IF2-B");
  });

  it("gives each row a distinct key", () => {
    const out = rows([
      start("Bash"),
      end(),
      { type: "text", data: {} },
      { type: "text", data: {} },
    ]);
    expect(new Set(out.map((r) => r.key)).size).toBe(out.length);
  });
});
