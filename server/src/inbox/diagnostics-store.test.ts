// Persistence behind `diagnostics.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-diagnostics-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentById,
  insertInboxMessage,
  insertTaskActivity,
  lastSessionOfTask,
  openRetryDiagnosticsOfTask,
  taskWithAssignee,
} = await import("./diagnostics-store.js");
const { ANSWERED_BY, INBOX_KIND, INBOX_STATUS, ON_ANSWER } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "p1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "r1", kind: RUNNER_KIND.docker }).run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "t1",
    assigneeAgentId: "a1",
    createdAt: now,
    updatedAt: now,
  })
  .run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "haiku",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();

it("taskWithAssignee and agentById read the task and its assignee", () => {
  const task = taskWithAssignee("t1");
  assert.equal(task?.assigneeAgentId, "a1");
  assert.equal(agentById("a1")?.name, "a1");
});

it("lastSessionOfTask returns the task's session", () => {
  assert.equal(lastSessionOfTask("t1")?.id, "s1");
});

it("insertInboxMessage writes the row, openRetryDiagnosticsOfTask finds it", () => {
  insertInboxMessage({
    id: "diag1",
    sessionId: "s1",
    taskId: "t1",
    agentId: "a1",
    kind: INBOX_KIND.choice,
    body: "failure",
    status: INBOX_STATUS.open,
    onAnswer: ON_ANSWER.retryTask,
    createdAt: now,
  });
  assert.equal(openRetryDiagnosticsOfTask("t1").length, 1);
});

it("insertTaskActivity adds an entry to the task activity", () => {
  insertTaskActivity({
    id: "act1",
    taskId: "t1",
    from: ANSWERED_BY.system,
    body: "note",
    createdAt: now,
  });
  const rows = db.select().from(schema.taskActivity).all();
  assert.equal(
    rows.some((r) => r.id === "act1"),
    true,
  );
});
