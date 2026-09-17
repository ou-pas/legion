// The task, the target agent, and the transaction setting edited fields, nothing if the status moved
// since the read. Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { findAgentRow, findTaskRow, updateTaskFields } = await import("./task-edit-store.js");
const { EDITABLE_STATUSES, TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: P, name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values([
    {
      id: "editable",
      projectId: P,
      name: "pending",
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "started",
      projectId: P,
      name: "started",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

describe("findTaskRow / findAgentRow", () => {
  it("return the row, or undefined", () => {
    assert.equal(findTaskRow("editable")?.name, "pending");
    assert.equal(findTaskRow("never-seen"), undefined);
    assert.equal(findAgentRow("a1")?.name, "a1");
    assert.equal(findAgentRow("never-seen"), undefined);
  });
});

describe("updateTaskFields", () => {
  it("sets the fields and returns the number of rows touched", () => {
    const n = updateTaskFields("editable", { name: "renamed" }, EDITABLE_STATUSES);
    assert.equal(n, 1);
    assert.equal(
      db
        .select()
        .from(schema.tasks)
        .all()
        .find((t) => t.id === "editable")?.name,
      "renamed",
    );
  });

  it("returns 0 (lost race) if the status is no longer in `requireStatusIn`", () => {
    const n = updateTaskFields("started", { name: "too late" }, EDITABLE_STATUSES);
    assert.equal(n, 0);
    assert.equal(
      db
        .select()
        .from(schema.tasks)
        .all()
        .find((t) => t.id === "started")?.name,
      "started",
    );
  });

  it("hard-codes no list: `requireStatusIn` decides, not the store", () => {
    const n = updateTaskFields("started", { name: "anyway" }, [TASK_STATUS.doing]);
    assert.equal(n, 1, "started is editable as soon as the caller allows it");
    assert.equal(
      db
        .select()
        .from(schema.tasks)
        .all()
        .find((t) => t.id === "started")?.name,
      "anyway",
    );
  });
});
