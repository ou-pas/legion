// Reads behind `inbox-history.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-history-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { agentNameById, inboxRowsOfTask, taskNameStatusById } =
  await import("./inbox-history-store.js");
const { INBOX_KIND, INBOX_STATUS } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "p1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "r1", kind: RUNNER_KIND.docker }).run();
db.insert(schema.tasks)
  .values({ id: "t1", projectId: "p1", name: "t1", createdAt: now, updatedAt: now })
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
db.insert(schema.inboxMessages)
  .values([
    {
      id: "i1",
      sessionId: "s1",
      taskId: "t1",
      agentId: "a1",
      kind: INBOX_KIND.text,
      body: "one",
      status: INBOX_STATUS.open,
      createdAt: now,
    },
    {
      id: "i2",
      sessionId: "s1",
      taskId: "t1",
      agentId: "a1",
      kind: INBOX_KIND.text,
      body: "two",
      status: INBOX_STATUS.open,
      createdAt: new Date(now.getTime() + 1),
    },
  ])
  .run();

it("inboxRowsOfTask returns the task's rows in arrival order", () => {
  assert.deepEqual(
    inboxRowsOfTask("t1").map((r) => r.id),
    ["i1", "i2"],
  );
});

it("agentNameById and taskNameStatusById read name and status", () => {
  assert.equal(agentNameById("a1"), "a1");
  assert.equal(taskNameStatusById("t1")?.name, "t1");
});
