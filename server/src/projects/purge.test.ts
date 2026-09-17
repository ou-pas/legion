// Deleting a blocker (spec "decoupe", behaviour 8, slice 02): a deleted blocker stops blocking, and
// if it was the last one the task is released inside the delete transaction.
//
//  1. Deleting a blocker that is not the last does not release: the remaining link holds.
//  2. Deleting the last releases: no link left, and the queue picks it up.
//  3. Inside the delete transaction: a rolled-back delete restores the link with the task.
//
// Same harness as queue-todo.test.ts (fake runner): `provisioned` proves the release.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-purge-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { deleteTask } = await import("./purge.js");
const { addBlocker, blockedTaskIds, blockersOf } = await import("../tasks/blockers.js");
const { pumpQueue } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

type Spec = import("../sessions/runner/types.js").SessionSpec;
let provisioned: Spec[] = [];
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned.push(spec);
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.taskActivity).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.notices).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "agent",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  provisioned = [];
}

/** No assignee by default: the queue only takes tasks that have one, so a blocker never leaves on
 *  its own. The dependent gets one, and it is the one watched. */
function makeTask(id: string, over: Partial<typeof schema.tasks.$inferInsert> = {}) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .run();
}

const taskRow = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
const settle = () => new Promise((r) => setTimeout(r, 80));

describe("deleteTask: deleting a blocker", () => {
  beforeEach(() => reset());

  it("deleting a blocker that is not the last does not release", async () => {
    makeTask("A");
    makeTask("B");
    makeTask("t", { assigneeAgentId: AGENT });
    addBlocker("t", "A");
    addBlocker("t", "B");

    deleteTask("A");
    assert.equal(taskRow("A"), undefined);
    assert.deepEqual(blockersOf("t"), ["B"], "B still holds");
    assert.ok(blockedTaskIds().has("t"));
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 0, "the queue does not take it");
  });

  it("deleting the last blocker releases the task, and the queue takes it", async () => {
    makeTask("B");
    makeTask("t", { assigneeAgentId: AGENT });
    addBlocker("t", "B");

    deleteTask("B");
    assert.deepEqual(blockersOf("t"), [], "nothing holds it anymore");
    assert.ok(!blockedTaskIds().has("t"));
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 1, "free means taken at the next pump");
    assert.equal(provisioned[0]?.taskId, "t");
  });

  it("release is decided inside the delete transaction: rolled back, the link returns with the task", () => {
    makeTask("B");
    makeTask("t");
    addBlocker("t", "B");
    assert.throws(
      () =>
        db.transaction(() => {
          deleteTask("B");
          assert.deepEqual(blockersOf("t"), [], "seen from inside, t is released");
          throw new Error("the transaction fails after the delete");
        }),
      /fails after/,
    );
    assert.ok(taskRow("B"), "B is back");
    assert.deepEqual(blockersOf("t"), ["B"], "and its link with it: no release without a delete");
  });
});
