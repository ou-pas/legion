// The task, the designated runner, and setting the choice. Real temporary SQLite, like its domain
// neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-runner-choice-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { findTaskRow, runnerExists, setChosenRunner } =
  await import("./task-runner-choice-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.runners).values({ id: "r1", name: "mini", kind: "process" }).run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: P,
    name: "T1",
    status: TASK_STATUS.todo,
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("findTaskRow", () => {
  it("returns the row, or undefined", () => {
    assert.equal(findTaskRow("t1")?.name, "T1");
    assert.equal(findTaskRow("never-seen"), undefined);
  });
});

describe("runnerExists", () => {
  it("says whether the runner exists", () => {
    assert.equal(runnerExists("r1"), true);
    assert.equal(runnerExists("never-seen"), false);
  });
});

describe("setChosenRunner", () => {
  it("sets the chosen runner, and clears it with `null`", () => {
    assert.equal(setChosenRunner("t1", "r1")?.chosenRunnerId, "r1");
    assert.equal(setChosenRunner("t1", null)?.chosenRunnerId, null);
  });

  it("returns undefined if the task vanished", () => {
    assert.equal(setChosenRunner("never-seen", "r1"), undefined);
  });
});
