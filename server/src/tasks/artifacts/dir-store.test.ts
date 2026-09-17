// Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-artifacts-dir-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { taskWithProject } = await import("./dir-store.js");
const { TASK_STATUS } = await import("../lifecycle.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "task",
    status: TASK_STATUS.todo,
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("taskWithProject", () => {
  it("returns the task and its project together", () => {
    const r = taskWithProject("t1");
    assert.equal(r?.task.id, "t1");
    assert.equal(r?.project.id, "p1");
  });

  it("returns `null` when the task does not exist", () => {
    assert.equal(taskWithProject("never-seen"), null);
  });
});
