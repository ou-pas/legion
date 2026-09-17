// The lineage walk (tasks by id, by parent) and tasks awaited through `wait_for_task` (v26). Real
// temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-artifact-scope-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { awaitedTaskIds, tasksByIds, tasksByParentIds } = await import("./scope-store.js");
const { TASK_STATUS } = await import("../lifecycle.js");

const P = "p1";
const now = new Date();

db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: P, name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values([
    {
      id: "root",
      projectId: P,
      name: "root",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "child",
      projectId: P,
      name: "child",
      status: TASK_STATUS.todo,
      proposedFromTaskId: "root",
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();
db.insert(schema.runners).values({ id: "r1", name: "mini", kind: "process" }).run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "root",
    agentId: "a1",
    runnerId: "r1",
    model: "sonnet",
    status: "waiting",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();
db.insert(schema.inboxMessages)
  .values({
    id: "m1",
    sessionId: "s1",
    taskId: "root",
    agentId: "a1",
    kind: "text",
    body: "waiting",
    waitForTaskId: "child",
    createdAt: now,
  })
  .run();

describe("awaitedTaskIds", () => {
  it("returns the tasks these tasks wait for, nothing for an empty list", () => {
    assert.deepEqual(awaitedTaskIds(["root"]), ["child"]);
    assert.deepEqual(awaitedTaskIds([]), []);
  });
});

describe("tasksByIds", () => {
  it("returns the project's tasks whose id is in the list, nothing for an empty list", () => {
    assert.deepEqual(
      tasksByIds(["root", "child"], P)
        .map((t) => t.id)
        .sort(),
      ["child", "root"],
    );
    assert.deepEqual(tasksByIds([], P), []);
    assert.deepEqual(tasksByIds(["root"], "other-project"), []);
  });
});

describe("tasksByParentIds", () => {
  it("returns tasks whose origin is in the list, nothing for an empty list", () => {
    assert.deepEqual(
      tasksByParentIds(["root"], P).map((t) => t.id),
      ["child"],
    );
    assert.deepEqual(tasksByParentIds([], P), []);
  });
});
