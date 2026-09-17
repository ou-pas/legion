// What this file protects:
//
//  1. `addBlockerIds`/`removeBlockerIds` apply while no session runs, and otherwise refuse by name
//     (404, live session, demo project); same discipline as `task-edit.test.ts`: a mute refusal
//     cannot be repaired.
//  2. `validateBlockerLinks`'s four validations (self-blocking, existence, project, already done)
//     and the cycle surface here, propagated as is; not retested in detail (that is
//     `blockers.test.ts`), only checked to block the write.
//  3. add and remove never overwrite each other: asking both on the same id is refused, not
//     silently arbitrated.
//
// Real temporary SQLite, like task-edit.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-blocker-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { applyBlockerEdit } = await import("./task-blocker-edit.js");
const { applyBlockerChanges } = await import("./task-blocker-edit-store.js");
const { addBlocker, blockersOf } = await import("./blockers.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { ACTIVE_STATUSES } = await import("../sessions/session-terminal.js");

const P1 = "p1";
const P2 = "p2";
const A1 = "a1";
const RUNNER = "r1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects)
    .values([
      { id: P1, name: "P1", slug: "p1", createdAt: now },
      { id: P2, name: "P2", slug: "p2", createdAt: now },
    ])
    .run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "a1", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
}

function makeTask(
  id: string,
  status: TaskStatus = TASK_STATUS.todo,
  extra: Partial<typeof schema.tasks.$inferInsert> = {},
) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: P1,
      name: id,
      status,
      assigneeAgentId: A1,
      createdAt: now,
      updatedAt: now,
      ...extra,
    })
    .run();
}

function makeLiveSession(taskId: string) {
  db.insert(schema.sessions)
    .values({
      id: `s-${taskId}`,
      taskId,
      agentId: A1,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: new Date(),
    })
    .run();
}

describe("applyBlockerEdit", () => {
  beforeEach(() => reset());

  it("adds a blocker on a later task", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: ["A"] });
    assert.ok(r.ok);
    assert.deepEqual(blockersOf("t"), ["A"]);
    assert.ok(r.ok && r.task.updatedAt.getTime() > 0);
  });

  it("adds on a todo task", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.todo);
    const r = applyBlockerEdit("t", { add: ["A"] });
    assert.ok(r.ok);
    assert.deepEqual(blockersOf("t"), ["A"]);
  });

  it("removes an existing blocker", () => {
    makeTask("A");
    makeTask("B");
    makeTask("t", TASK_STATUS.todo);
    addBlocker("t", "A");
    addBlocker("t", "B");
    const r = applyBlockerEdit("t", { remove: ["A"] });
    assert.ok(r.ok);
    assert.deepEqual(blockersOf("t"), ["B"]);
  });

  it("adds and removes in the same call", () => {
    makeTask("A");
    makeTask("B");
    makeTask("t", TASK_STATUS.todo);
    addBlocker("t", "A");
    const r = applyBlockerEdit("t", { add: ["B"], remove: ["A"] });
    assert.ok(r.ok);
    assert.deepEqual(blockersOf("t").sort(), ["B"]);
  });

  it("neither add nor remove → 400", () => {
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", {});
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("empty add and remove (arrays) → 400, like absent", () => {
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: [], remove: [] });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("an id both added and removed → 400, refused rather than arbitrated", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: ["A"], remove: ["A"] });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && r.error.includes("A"));
  });

  it("add is not an array → 400", () => {
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: "A" as never });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("missing task → 404", () => {
    const r = applyBlockerEdit("does-not-exist", { add: ["A"] });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 404);
  });

  // 10/09: status no longer freezes anything, which makes a link repairable. A blocker is read at
  // launch: it decides the next launch, not the one that already happened. Seen on `T6ywbnqS3Y`,
  // moved to `review` with a blocker set backwards by `propose_task`; no gesture could undo it, and
  // its PR stayed in conflict with no recourse.
  it("doing task without a live session: blockers are still editable", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.doing);
    const r = applyBlockerEdit("t", { add: ["A"] });
    assert.equal(r.ok, true);
    assert.deepEqual(blockersOf("t"), ["A"]);
  });

  it("review task: a wrongly set blocker can be removed", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.review);
    addBlocker("t", "A");
    const r = applyBlockerEdit("t", { remove: ["A"] });
    assert.equal(r.ok, true);
    assert.deepEqual(blockersOf("t"), []);
  });

  it("done task: same, status freezes nothing", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.done);
    const r = applyBlockerEdit("t", { add: ["A"] });
    assert.equal(r.ok, true);
  });

  it("todo task with a live session → 409, the message names the session", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.todo);
    makeLiveSession("t");
    const r = applyBlockerEdit("t", { add: ["A"] });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 409 && r.error.includes("running"));
    assert.ok(!r.ok && r.live && r.live.length === 1);
  });

  // The second guard, the transaction's: it closes the race where a session starts during the call.
  // Called directly, because through the route the first guard answers before it, and a guard no
  // test reaches is a guard we only think we have.
  it("session started during the call → the write is refused in the transaction", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.later);
    makeLiveSession("t");
    assert.equal(applyBlockerChanges("t", ["A"], [], ACTIVE_STATUSES), false);
    assert.deepEqual(blockersOf("t"), []);
  });

  it("self-blocking → 400, propagated from validateBlockerLinks", () => {
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: ["t"] });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && /cannot block itself/.test(r.error));
  });

  it("blocker from another project → 400, propagated", () => {
    const now = new Date();
    db.insert(schema.tasks)
      .values({
        id: "foreign",
        projectId: P2,
        name: "Elsewhere",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: ["foreign"] });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && r.error.includes("Elsewhere"));
  });

  it("blocker already done → 400, propagated", () => {
    makeTask("A", TASK_STATUS.done);
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: ["A"] });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400);
  });

  it("cycle → 400, propagated", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.later);
    addBlocker("A", "t"); // A already waits for t
    const r = applyBlockerEdit("t", { add: ["A"] }); // t would wait for A → cycle
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && /cycle/.test(r.error));
  });

  it("removing an absent link is a no-op, not a fault", () => {
    makeTask("A");
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { remove: ["A"] });
    assert.ok(r.ok);
    assert.deepEqual(blockersOf("t"), []);
  });

  it("demo project → refused", () => {
    db.update(schema.projects).set({ demo: true }).where(eq(schema.projects.id, P1)).run();
    makeTask("A");
    makeTask("t", TASK_STATUS.later);
    const r = applyBlockerEdit("t", { add: ["A"] });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);
  });
});
