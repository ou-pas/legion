// Inserting the task and its blockers in one transaction. Real temporary SQLite, like its domain
// neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-create-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { insertTask } = await import("./task-create-store.js");
const { blockersOf } = await import("./blockers-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.tasks)
  .values({
    id: "b1",
    projectId: P,
    name: "blocker",
    status: TASK_STATUS.todo,
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("insertTask", () => {
  it("inserts the task with its blockers, in a single transaction", () => {
    const row = insertTask(
      {
        id: "t1",
        projectId: P,
        name: "new",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      },
      ["b1"],
    );
    assert.equal(row?.id, "t1");
    assert.deepEqual(blockersOf("t1"), ["b1"]);
  });

  it("inserts without a blocker when the list is empty", () => {
    const row = insertTask(
      {
        id: "t2",
        projectId: P,
        name: "unlinked",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      },
      [],
    );
    assert.equal(row?.id, "t2");
    assert.deepEqual(blockersOf("t2"), []);
  });
});
