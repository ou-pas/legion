import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-purge-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentRowById,
  countActivityOfTask,
  countAgentsOfProject,
  countInboxOfTask,
  countInboxOfTasks,
  countSessionEventsOfSessions,
  deleteProjectCascade,
  deleteTaskCascade,
  goalIdsOfProject,
  projectRowById,
  sessionIdsOfTask,
  sessionIdsOfTasks,
  sessionRowsForTaskInStatuses,
  taskIdsOfProject,
  taskNamesByIds,
  taskRowById,
} = await import("./purge-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "T1",
    status: "todo",
    boardOrder: 0,
    createdAt: now,
    updatedAt: now,
  })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "local", kind: "docker" }).run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "m",
    callbackToken: "tok",
    status: "running",
    startedAt: now,
  })
  .run();
db.insert(schema.inboxMessages)
  .values({
    id: "i1",
    sessionId: "s1",
    taskId: "t1",
    agentId: "a1",
    kind: "text",
    body: "hello",
    createdAt: now,
  })
  .run();
db.insert(schema.taskActivity)
  .values({ id: "act1", taskId: "t1", from: "agent", body: "b", createdAt: now })
  .run();
db.insert(schema.goals)
  .values({
    id: "g1",
    projectId: "p1",
    name: "goal",
    request: "faire X",
    status: "active",
    createdAt: now,
  })
  .run();

describe("purge-store: reads", () => {
  it("finds project, task and agent by id", () => {
    assert.equal(projectRowById("p1")?.name, "P1");
    assert.equal(taskRowById("t1")?.name, "T1");
    assert.equal(agentRowById("a1")?.name, "a1");
    assert.equal(projectRowById("nope"), undefined);
  });

  it("lists a project's dependent ids", () => {
    assert.deepEqual(taskIdsOfProject("p1"), ["t1"]);
    assert.deepEqual(sessionIdsOfTasks(["t1"]), ["s1"]);
    assert.deepEqual(sessionIdsOfTask("t1"), ["s1"]);
    assert.deepEqual(goalIdsOfProject("p1"), ["g1"]);
    assert.deepEqual(sessionIdsOfTasks([]), []);
  });

  it("counts what a delete would destroy", () => {
    assert.equal(countAgentsOfProject("p1"), 1);
    assert.equal(countInboxOfTasks(["t1"]), 1);
    assert.equal(countInboxOfTask("t1"), 1);
    assert.equal(countActivityOfTask("t1"), 1);
    assert.equal(countSessionEventsOfSessions(["s1"]), 0);
    assert.equal(countInboxOfTasks([]), 0);
  });

  it("filters sessions by status and names their task", () => {
    assert.equal(sessionRowsForTaskInStatuses("t1", ["running"]).length, 1);
    assert.equal(sessionRowsForTaskInStatuses("t1", ["failed"]).length, 0);
    assert.equal(taskNamesByIds(["t1"]).get("t1"), "T1");
  });
});

describe("purge-store: cascades", () => {
  it("deleteTaskCascade removes the task and descendants, calling the callback first", () => {
    let calledBefore = false;
    deleteTaskCascade("t1", ["s1"], () => {
      calledBefore = true;
      assert.equal(taskRowById("t1")?.name, "T1", "the task still exists during the callback");
    });
    assert.equal(calledBefore, true);
    assert.equal(taskRowById("t1"), undefined);
    assert.equal(db.select().from(schema.sessions).all().length, 0);
    assert.equal(db.select().from(schema.inboxMessages).all().length, 0);
  });

  it("deleteProjectCascade removes the project and descendants", () => {
    deleteProjectCascade({ projectId: "p1", taskIds: [], sessionIds: [], goalIds: ["g1"] });
    assert.equal(projectRowById("p1"), undefined);
    assert.equal(db.select().from(schema.agents).all().length, 0);
    assert.equal(db.select().from(schema.goals).all().length, 0);
  });
});
