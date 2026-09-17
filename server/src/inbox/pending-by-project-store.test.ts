// Raw reads behind `pendingByProject`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-pending-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { allProjectIds, openInboxRows, reviewGateProjectIds } =
  await import("./pending-by-project-store.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
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
db.insert(schema.tasks)
  .values({
    id: "t2",
    projectId: "p1",
    name: "t2",
    createdAt: now,
    updatedAt: now,
    approvalGate: true,
    status: TASK_STATUS.review,
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
db.insert(schema.inboxMessages)
  .values({
    id: "i1",
    sessionId: "s1",
    taskId: "t1",
    agentId: "a1",
    kind: INBOX_KIND.text,
    body: "?",
    status: INBOX_STATUS.open,
    createdAt: now,
  })
  .run();

it("allProjectIds returns every project", () => {
  assert.deepEqual(allProjectIds(), ["p1"]);
});

it("openInboxRows returns open entries with their project", () => {
  const rows = openInboxRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.projectId, "p1");
  assert.equal(rows[0]?.waitForTaskId, null);
});

it("reviewGateProjectIds returns projects of gated tasks in review", () => {
  assert.deepEqual(reviewGateProjectIds(), ["p1"]);
});
