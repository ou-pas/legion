// Settlement says why it settles (v56).
//
// `review` was the sink of every ending: delivered work, an OOM, an API error, a requested stop. On
// 03/09 two failures produced the same display an hour apart: a session killed by an OOM after 49
// writes never pushed, and six attempts dead on "API Error: 529 Overloaded", which the SDK returns
// as a `result` of subtype `success`.
//
// These tests pin the notice, not the status: the column stays `review` in every case, on purpose.
// Settling a failure to `todo` would put it back in the queue, and a persistent 529 would loop (see
// manager.ts, "never an automatic rerun").
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-settled-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, listControlEvents, schema } = await import("../shared/db.js");
const { FS_OP_EVENT, REPO_CHECKPOINT_EVENT, REPO_PUSH_EVENT } = await import("../shared/events.js");
const { SETTLED, markTaskStarted, settleTaskAfterSession } = await import("./lifecycle.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const TASK = "t1";
const RUNNER = "r1";

function seed(): void {
  const now = new Date();
  // `controlEvents` too: the trace set by `logAutomaticSettlement` must be read per test, not pile
  // up across the file.
  db.delete(schema.controlEvents).run();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  // `sessions.runner_id` has an FK: without a declared machine, no session inserts.
  db.insert(schema.runners)
    .values({ id: RUNNER, name: "local-test", kind: RUNNER_KIND.docker })
    .run();
  db.insert(schema.projects).values({ id: PROJECT, name: "T", slug: "t", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: PROJECT,
      name: "t",
      status: TASK_STATUS.doing,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/** An ended session of the task. Settlement only rules on endings: while a session is active,
 *  `settleTaskAfterSession` touches nothing (that is what keeps a paused session from being settled
 *  under the sleeping agent). */
function endedSession(id: string, status: "destroyed" | "failed", startedAt = new Date()): string {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: TASK,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "haiku",
      status,
      callbackToken: `tok-${id}`,
      startedAt,
      endedAt: new Date(),
    })
    .run();
  return id;
}

function event(sessionId: string, type: string, payload: unknown): void {
  db.insert(schema.sessionEvents)
    .values({ sessionId, type, payload: JSON.stringify(payload), createdAt: new Date() })
    .run();
}

const taskRow = () => db.select().from(schema.tasks).where(eq(schema.tasks.id, TASK)).get();

describe("settleTaskAfterSession: the notice", () => {
  beforeEach(() => seed());

  it("a failed session gives failed", () => {
    endedSession("s1", "failed");
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.status, TASK_STATUS.review);
    assert.equal(taskRow()?.settledOutcome, SETTLED.failed);
  });

  // The 529 case: exit without error, nothing produced. The one that passed for a success, six
  // attempts in a row.
  it("an error-free exit that produced nothing gives empty", () => {
    const s = endedSession("s1", "destroyed");
    event(s, "result", { subtype: "success", numTurns: 1 });
    event(s, REPO_PUSH_EVENT, { repo: "legion", changes: 0 });
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.settledOutcome, SETTLED.empty);
  });

  it("a push with changes gives delivered", () => {
    const s = endedSession("s1", "destroyed");
    event(s, REPO_PUSH_EVENT, { repo: "legion", changes: 4, commit: "463c0ae" });
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.settledOutcome, SETTLED.delivered);
  });

  // What catches read-only tasks: they never push anything by construction, and their deliverable
  // is an artifact. Without this signal every successful audit would be recorded empty.
  it("a file write is enough, without any push", () => {
    const s = endedSession("s1", "destroyed");
    event(s, FS_OP_EVENT, { op: "write", path: "/artifacts/t1/implementation.md" });
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.settledOutcome, SETTLED.delivered);
  });

  // The `P2BYzKpcD1` case (14/09): 99 tool calls, two pushed checkpoints, and a final push rejected
  // as non-fast-forward. A failing push emits no `repo_push`, so the session lost at once the trace
  // of everything its checkpoints had put on the branch, and settlement announced "produced
  // nothing" on work actually delivered.
  it("a pushed checkpoint is enough, even if the final push fails", () => {
    const s = endedSession("s1", "destroyed");
    event(s, REPO_CHECKPOINT_EVENT, { repo: "legion", turn: 30, commit: "48b8c63" });
    event(s, "repo_push_failed", { repo: "legion", error: "non-fast-forward" });
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.settledOutcome, SETTLED.delivered);
  });

  it("but reading files produces nothing", () => {
    const s = endedSession("s1", "destroyed");
    event(s, FS_OP_EVENT, { op: "read", path: "/artifacts/t1/spec.md" });
    event(s, FS_OP_EVENT, { op: "list", path: "/artifacts/t1" });
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.settledOutcome, SETTLED.empty);
  });

  it("an unreadable event payload is not a delivery, and does not fail settlement", () => {
    const s = endedSession("s1", "destroyed");
    db.insert(schema.sessionEvents)
      .values({
        sessionId: s,
        type: REPO_PUSH_EVENT,
        payload: "{this is not JSON",
        createdAt: new Date(),
      })
      .run();
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.settledOutcome, SETTLED.empty);
  });

  // A previous attempt's work counts: the question is "did this task produce anything", not "this
  // run".
  it("a push from an earlier session still counts", () => {
    const old = endedSession("s0", "destroyed", new Date(Date.now() - 60_000));
    event(old, REPO_PUSH_EVENT, { repo: "legion", changes: 2 });
    endedSession("s1", "destroyed");
    assert.equal(settleTaskAfterSession(TASK), true);
    assert.equal(taskRow()?.settledOutcome, SETTLED.delivered);
  });

  it("a still active session prevents any settlement", () => {
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId: TASK,
        agentId: AGENT,
        runnerId: RUNNER,
        model: "haiku",
        status: SESSION_STATUS.waiting,
        callbackToken: "tok",
        startedAt: new Date(),
      })
      .run();
    assert.equal(settleTaskAfterSession(TASK), false);
    assert.equal(taskRow()?.status, TASK_STATUS.doing, "a pause does not settle the task");
    assert.equal(taskRow()?.settledOutcome, null);
  });

  it("an already settled task is not re-noticed", () => {
    endedSession("s1", "failed");
    settleTaskAfterSession(TASK);
    // An operator stop may have set its own notice before the sweep: it must not be overwritten by
    // this one. `settle`'s `from: doing` takes care of it.
    db.update(schema.tasks)
      .set({ settledOutcome: SETTLED.stopped })
      .where(eq(schema.tasks.id, TASK))
      .run();
    assert.equal(settleTaskAfterSession(TASK), false);
    assert.equal(taskRow()?.settledOutcome, SETTLED.stopped);
  });
});

describe("settleTaskAfterSession: the control-plane trace", () => {
  beforeEach(() => seed());

  // Before this test: a session dead on an API overload (or any failure) left no row in
  // `control_events`; the information only existed in that session's feed, reopened task by task.
  // Same family as preflight refusals.
  it("an empty notice (the 529 case) sets a control-plane trace", () => {
    const s = endedSession("s1", "destroyed");
    event(s, "result", { subtype: "success", isError: true, apiErrorStatus: 529, numTurns: 1 });
    event(s, REPO_PUSH_EVENT, { repo: "legion", changes: 0 });
    settleTaskAfterSession(TASK);
    const traces = listControlEvents({}).filter((e) => e.source === "task-settle");
    assert.equal(traces.length, 1);
    const trace = traces[0]!;
    assert.equal(trace.level, "warn");
    assert.match(trace.message, new RegExp(TASK));
    assert.deepEqual(trace.payload, {
      taskId: TASK,
      outcome: SETTLED.empty,
      sessionId: s,
      endReason: null,
    });
  });

  it("a failed notice sets a trace too", () => {
    endedSession("s1", "failed");
    settleTaskAfterSession(TASK);
    const traces = listControlEvents({}).filter((e) => e.source === "task-settle");
    assert.equal(traces.length, 1);
    assert.equal((traces[0]!.payload as { outcome: string }).outcome, SETTLED.failed);
  });

  // `delivered` is not an incident: nothing to trace, or every delivered task would swell the
  // control plane log for nothing.
  it("a delivered notice sets no trace", () => {
    const s = endedSession("s1", "destroyed");
    event(s, REPO_PUSH_EVENT, { repo: "legion", changes: 3 });
    settleTaskAfterSession(TASK);
    assert.equal(listControlEvents({}).filter((e) => e.source === "task-settle").length, 0);
  });

  it("a still active session sets no trace", () => {
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId: TASK,
        agentId: AGENT,
        runnerId: RUNNER,
        model: "haiku",
        status: SESSION_STATUS.waiting,
        callbackToken: "tok",
        startedAt: new Date(),
      })
      .run();
    settleTaskAfterSession(TASK);
    assert.equal(listControlEvents({}).filter((e) => e.source === "task-settle").length, 0);
  });
});

describe("markTaskStarted: the notice clears", () => {
  beforeEach(() => seed());

  // A stale notice is worse than none: it looks like a fact.
  it("rerunning a task clears the previous ending's notice", () => {
    endedSession("s1", "failed");
    settleTaskAfterSession(TASK);
    assert.equal(taskRow()?.settledOutcome, SETTLED.failed);

    assert.equal(markTaskStarted(TASK), true);
    assert.equal(taskRow()?.status, TASK_STATUS.doing);
    assert.equal(taskRow()?.settledOutcome, null);
  });
});
