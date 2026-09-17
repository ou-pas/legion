// Persistence behind `session-close.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-session-close-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { closeInboxMessage, closeOpenInboxOfSession, openInboxIdsOfDeadSessions } =
  await import("./session-close-store.js");
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
    id: "s-dead",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "haiku",
    callbackToken: "tok1",
    startedAt: now,
    status: "destroyed",
  })
  .run();
db.insert(schema.sessions)
  .values({
    id: "s-alive",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "haiku",
    callbackToken: "tok2",
    startedAt: now,
    status: "waiting",
  })
  .run();
db.insert(schema.inboxMessages)
  .values({
    id: "i-dead",
    sessionId: "s-dead",
    taskId: "t1",
    agentId: "a1",
    kind: INBOX_KIND.text,
    body: "?",
    status: INBOX_STATUS.open,
    createdAt: now,
  })
  .run();
db.insert(schema.inboxMessages)
  .values({
    id: "i-alive",
    sessionId: "s-alive",
    taskId: "t1",
    agentId: "a1",
    kind: INBOX_KIND.text,
    body: "?",
    status: INBOX_STATUS.open,
    createdAt: now,
  })
  .run();

it("openInboxIdsOfDeadSessions returns only a terminal session's entry", () => {
  assert.deepEqual(openInboxIdsOfDeadSessions(), ["i-dead"]);
});

it("closeInboxMessage closes only the targeted row", () => {
  closeInboxMessage("i-dead");
  const rows = db.select().from(schema.inboxMessages).all();
  assert.equal(rows.find((r) => r.id === "i-dead")?.status, INBOX_STATUS.closed);
  assert.equal(rows.find((r) => r.id === "i-alive")?.status, INBOX_STATUS.open);
});

it("closeOpenInboxOfSession closes that session's open entry", () => {
  closeOpenInboxOfSession("s-alive");
  assert.equal(
    db
      .select()
      .from(schema.inboxMessages)
      .all()
      .find((r) => r.id === "i-alive")?.status,
    INBOX_STATUS.closed,
  );
});
