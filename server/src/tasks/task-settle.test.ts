// What happens to the task when a session stops (26/08).
//
// The bug that paid for this file: `fxHi2IpRXo`. Its session ended in success (the runtime reported
// a successful `result`, the container left cleanly) and the task stayed `doing`. Forever. No live
// session behind it, no artifact, no branch, no report, and the board showing "doing" on work
// stopped an hour earlier. A task in that state never returns to anyone's attention: it is neither
// queued, nor to review, nor finished.
//
// The cause was two words: `if (failed)`. Both places settling the task did so only on failure,
// assuming a succeeding agent calls `update_task` and settles itself. True most of the time, and
// exactly the kind of assumption that must not carry an invariant.
//
// What these tests mostly protect is the opposite: a stopping session is not a stopping task. An
// inbox pause destroys the container and resumes later; settling the task then would pull it out
// from under the sleeping agent.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-settle-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const { settleTaskAfterSession } = await import("./lifecycle.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p-set",
  A = "a-set",
  T = "t-set",
  R = "r-set";
const now = new Date();

function reset(taskStatus: TaskStatus = TASK_STATUS.doing): void {
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "ag", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.tasks)
    .values({ id: T, projectId: P, name: "t", status: taskStatus, createdAt: now, updatedAt: now })
    .run();
  db.insert(schema.runners).values({ id: R, name: "local", kind: RUNNER_KIND.process }).run();
}

function session(id: string, status: string): void {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: T,
      agentId: A,
      runnerId: R,
      status: status as "running",
      model: "sonnet",
      callbackToken: `tok-${id}`,
      startedAt: now,
    })
    .run();
}

const taskStatus = () => db.select().from(schema.tasks).where(eq(schema.tasks.id, T)).get()!.status;

describe("a finished session whose agent did not settle", () => {
  beforeEach(() => reset(TASK_STATUS.doing));

  it("the fxHi2IpRXo case: session destroyed in success, task left doing", () => {
    // Without this settlement the task stays "doing" on the board while nothing runs.
    session("s1", "destroyed");
    assert.equal(settleTaskAfterSession(T), true);
    assert.equal(taskStatus(), TASK_STATUS.review);
  });

  it("and the failure case, which already worked", () => {
    session("s1", "failed");
    assert.equal(settleTaskAfterSession(T), true);
    assert.equal(taskStatus(), TASK_STATUS.review);
  });
});

describe("what must above all not be settled", () => {
  beforeEach(() => reset(TASK_STATUS.doing));

  it("an inbox pause: the container left, the session will resume", () => {
    // The trap of this batch. `waiting` has no container left; seen from Docker the session is dead.
    // Settling the task here would pull it out from under a sleeping agent that wakes on the answer.
    session("s1", SESSION_STATUS.waiting);
    assert.equal(settleTaskAfterSession(T), false);
    assert.equal(taskStatus(), TASK_STATUS.doing);
  });

  it("a second live session on the same task", () => {
    // One session dies, another already took over: the task is still working.
    session("s1", "failed");
    session("s2", "running");
    assert.equal(settleTaskAfterSession(T), false);
    assert.equal(taskStatus(), TASK_STATUS.doing);
  });

  it("a starting session counts as live", () => {
    session("s1", "destroyed");
    session("s2", "starting");
    assert.equal(settleTaskAfterSession(T), false);
    assert.equal(taskStatus(), TASK_STATUS.doing);
  });

  it("a committing session counts as live: that is where the push happens", () => {
    session("s1", "destroyed");
    session("s2", "committing");
    assert.equal(settleTaskAfterSession(T), false);
    assert.equal(taskStatus(), TASK_STATUS.doing);
  });
});

describe("the guard costs nothing when the agent did its job", () => {
  it("a task already in review is not touched", () => {
    // The agent called `update_task`: `settle`'s `from: doing` makes the call a no-op. That lets the
    // function be called unconditionally instead of guessing who must settle.
    reset(TASK_STATUS.review);
    session("s1", "destroyed");
    assert.equal(settleTaskAfterSession(T), false);
    assert.equal(taskStatus(), TASK_STATUS.review);
  });

  it("a task that never started stays todo", () => {
    reset(TASK_STATUS.todo);
    session("s1", "failed");
    assert.equal(settleTaskAfterSession(T), false);
    assert.equal(taskStatus(), TASK_STATUS.todo);
  });
});
