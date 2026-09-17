// The table, proven line by line. A signal that no longer invalidates anything breaks no display
// test and raises no error; it only shows the day someone stares at a frozen screen wondering since
// when.
import { describe, expect, it } from "vitest";
import { INVALIDATION, keysFor, parseControlEvent } from "./control-events.js";
import { qk } from "../queries.js";

const ev = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  sessionId: "s-1",
  ...extra,
});

describe("the table: a signal, the keys it makes stale", () => {
  it("a task's life wakes tasks, and the project's goals when known", () => {
    expect(keysFor(ev("task_status", { taskId: "t-1", projectId: "p-1" }))).toEqual([
      qk.tasks,
      qk.goals("p-1"),
    ]);
    expect(keysFor(ev("task_status"))).toEqual([qk.tasks]);
  });

  it("an inbox question wakes the inbox prefix, so the per-project badges too", () => {
    expect(keysFor(ev("inbox_ask", { taskId: "t-1" }))).toEqual([qk.inbox, qk.tasks]);
    // `["inbox"]` IS the prefix of `["inbox", "pending-by-project"]`: that keeps the table short,
    // and this test pins it.
    expect(qk.pendingByProject.slice(0, 1)).toEqual([...qk.inbox]);
  });

  it("a written file wakes ITS task's artifacts, and nothing else", () => {
    expect(keysFor(ev("fs_op", { taskId: "t-1" }))).toEqual([qk.artifacts("t-1")]);
    expect(keysFor(ev("fs_op"))).toEqual([qk.allArtifacts]);
  });

  it("a branch push wakes artifacts and tasks", () => {
    expect(keysFor(ev("repo_push", { taskId: "t-1" }))).toEqual([qk.artifacts("t-1"), qk.tasks]);
  });

  it("an unknown type makes nothing stale: the 60 s safety net handles it", () => {
    expect(keysFor(ev("text"))).toEqual([]);
    expect(keysFor(ev("tool_start"))).toEqual([]);
  });

  // The copy is DELIBERATE: it fails an accidental removal a walk over the table would not see. It
  // must stay the mirror of the server's `CONTROL_EVENT_TYPES`.
  it("the table covers exactly the types the server broadcasts", () => {
    expect(Object.keys(INVALIDATION)).toEqual([
      "status",
      "task_status",
      "task_proposed",
      "result",
      "run_error",
      // `inbox_draft` (07/09): a round started elsewhere. It stales the SAME family as the rest of
      // the inbox, prefix included, so a question page too. Without it four surfaces stayed at
      // "0 / 6" until the sixty-second safety net.
      "inbox_ask",
      "inbox_answer",
      "inbox_note",
      "inbox_draft",
      "dependency_wait",
      "dependency_resolved",
      "repo_push",
      "repo_push_failed",
      "fs_op",
    ]);
  });
});

describe("reading a line", () => {
  it("reads a complete signal", () => {
    expect(
      parseControlEvent(
        '{"type":"result","sessionId":"s-1","taskId":"t-1","projectId":"p-1","ts":7}',
      ),
    ).toEqual({ type: "result", sessionId: "s-1", taskId: "t-1", projectId: "p-1", ts: 7 });
  });

  it("an unreadable line or one without type becomes nothing, and does not throw", () => {
    expect(parseControlEvent("not json")).toBeNull();
    expect(parseControlEvent("null")).toBeNull();
    expect(parseControlEvent('{"sessionId":"s-1"}')).toBeNull();
    expect(parseControlEvent('{"type":""}')).toBeNull();
  });
});
