// Status, archiving and brief in one transaction, which also consumes the released blockers when
// the patch finishes the task. Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-patch-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { writeStatusArchivedDescription } = await import("./task-patch-store.js");
const { addBlocker, blockersOf } = await import("./blockers-store.js");
const { settleDone } = await import("../chains/templates.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.tasks)
  .values([
    {
      id: "t1",
      projectId: P,
      name: "T1",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t2",
      projectId: P,
      name: "T2",
      status: TASK_STATUS.todo,
      queued: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "blocker",
      projectId: P,
      name: "blocker",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "held",
      projectId: P,
      name: "held",
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

const row = (id: string) =>
  db
    .select()
    .from(schema.tasks)
    .all()
    .find((t) => t.id === id);

const noFinish = () => [];

describe("writeStatusArchivedDescription", () => {
  it("does nothing (returns []) when no field is given", () => {
    assert.deepEqual(writeStatusArchivedDescription("t1", {}, noFinish), []);
  });

  it("sets status/archiving/description together", () => {
    writeStatusArchivedDescription(
      "t1",
      { status: TASK_STATUS.review, archived: true, description: "updated brief" },
      noFinish,
    );
    const r = row("t1");
    assert.equal(r?.status, TASK_STATUS.review);
    assert.equal(r?.archived, true);
    assert.equal(r?.description, "updated brief");
  });

  it('sets `queued` as given: the "later leaves the queue" decision comes from the caller', () => {
    writeStatusArchivedDescription("t2", { status: TASK_STATUS.later, queued: false }, noFinish);
    assert.equal(row("t2")?.queued, false);
  });

  it("returns what `onFinish` returns, called inside the transaction", () => {
    addBlocker("held", "blocker");
    // `onFinish` here is the real `settleDone` (chains/templates.ts), what `task-patch.ts` passes in
    // production. This store does not know it, it calls what it is given.
    const released = writeStatusArchivedDescription("blocker", { status: TASK_STATUS.done }, () =>
      settleDone("blocker"),
    );
    assert.deepEqual(released, ["held"]);
    assert.deepEqual(blockersOf("held"), []);
  });
});
