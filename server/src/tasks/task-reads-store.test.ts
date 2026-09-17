// The raw reads the routes used to do themselves.
//
//  1. `findTask` returns `undefined` rather than a forced non-null: that removed five `!` from the
//     task routes, and it is the only difference that matters between the two forms;
//  2. `allTaskRows` does not forget archived tasks. The summary projection (no brief, no criteria)
//     is decided by the caller (`tasks/routes/crud.ts`, `serializeTaskSummaries`) and tested there
//     over HTTP (`crud.test.ts`);
//  3. an unknown task's activity log is empty, not an error.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-task-reads-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { allSessionRows, allTaskRows, classifyAgentsOf, demoProjectIds, findTask, taskActivity } =
  await import("./task-reads-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const OTHER = "p2";
const A = "a1";
const now = new Date();

db.delete(schema.tasks).run();
db.delete(schema.agents).run();
db.delete(schema.projects).run();
db.insert(schema.projects)
  .values([
    { id: P, name: "P", slug: "p1", createdAt: now },
    { id: OTHER, name: "Other", slug: "p2", createdAt: now },
  ])
  .run();
db.insert(schema.agents)
  .values([
    {
      id: A,
      projectId: P,
      name: "build",
      title: "Builder",
      rolePrompt: "you build",
      createdAt: now,
    },
    { id: "a2", projectId: OTHER, name: "elsewhere", rolePrompt: "r", createdAt: now },
  ])
  .run();
db.insert(schema.tasks)
  .values([
    {
      id: "t1",
      projectId: P,
      name: "in progress",
      status: TASK_STATUS.todo,
      assigneeAgentId: A,
      description: "a nice long brief",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t2",
      projectId: P,
      name: "tidied",
      status: TASK_STATUS.done,
      assigneeAgentId: A,
      archived: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();
db.insert(schema.taskActivity)
  .values({
    id: "act1",
    taskId: "t1",
    from: "system",
    body: "a word in the log",
    createdAt: now,
  })
  .run();

describe("findTask", () => {
  it("returns the row, or undefined, never a forced non-null", () => {
    assert.equal(findTask("t1")?.name, "in progress");
    assert.equal(findTask("never-seen"), undefined);
  });
});

describe("allTaskRows / allSessionRows / demoProjectIds", () => {
  it("allTaskRows returns all tasks, archived included: the summary projection is decided elsewhere", () => {
    assert.deepEqual(
      allTaskRows()
        .map((t) => t.id)
        .sort(),
      ["t1", "t2"],
    );
  });

  it("allSessionRows returns all sessions, empty when there are none", () => {
    assert.deepEqual(allSessionRows(), []);
  });

  it("demoProjectIds returns only demo projects", () => {
    assert.deepEqual(demoProjectIds(), new Set());
    db.update(schema.projects).set({ demo: true }).where(eq(schema.projects.id, P)).run();
    assert.deepEqual(demoProjectIds(), new Set([P]));
  });
});

describe("taskActivity", () => {
  it("returns the task's log, and nothing for an unknown task", () => {
    assert.equal(taskActivity("t1").length, 1);
    assert.deepEqual(taskActivity("never-seen"), []);
  });
});

describe("classifyAgentsOf", () => {
  it("returns only the project's agents, reduced to what the classifier reads", () => {
    const agents = classifyAgentsOf(P);
    assert.deepEqual(
      agents.map((a) => a.id),
      [A],
    );
    assert.deepEqual(Object.keys(agents[0] ?? {}).sort(), ["id", "name", "rolePrompt", "title"]);
    assert.deepEqual(classifyAgentsOf("ghost-project"), []);
  });
});
