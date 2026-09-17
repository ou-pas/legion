// Persistence behind `inbox.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentById,
  allInboxMessageRows,
  inboxMessageById,
  insertInboxMessageRow,
  latestSessionOfTask,
  markInboxMessageAnswered,
  reopenInboxMessage,
  sessionById,
  setSessionStatus,
  taskById,
} = await import("./inbox-store.js");
const { ANSWERED_BY, INBOX_KIND, INBOX_STATUS } = await import("./inbox-enums.js");
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
    callbackToken: "tok1",
    startedAt: now,
    status: "waiting",
  })
  .run();
db.insert(schema.sessions)
  .values({
    id: "s2",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "haiku",
    callbackToken: "tok2",
    startedAt: new Date(now.getTime() + 1000),
    status: "running",
  })
  .run();

it("sessionById, taskById, agentById read their row", () => {
  assert.equal(sessionById("s1")?.taskId, "t1");
  assert.equal(taskById("t1")?.name, "t1");
  assert.equal(agentById("a1")?.name, "a1");
});

it("latestSessionOfTask returns the most recent session", () => {
  assert.equal(latestSessionOfTask("t1")?.id, "s2");
});

it("setSessionStatus writes the new status", () => {
  setSessionStatus("s1", "blocked");
  assert.equal(sessionById("s1")?.status, "blocked");
});

it("inserts a row that inboxMessageById and allInboxMessageRows find", () => {
  insertInboxMessageRow({
    id: "i1",
    sessionId: "s1",
    taskId: "t1",
    agentId: "a1",
    kind: INBOX_KIND.text,
    body: "?",
    status: INBOX_STATUS.open,
    createdAt: now,
  });
  assert.equal(inboxMessageById("i1")?.body, "?");
  assert.equal(
    allInboxMessageRows().some((r) => r.id === "i1"),
    true,
  );
});

it("markInboxMessageAnswered writes the answer and clears the draft", () => {
  markInboxMessageAnswered("i1", {
    selectedChoiceId: null,
    answerText: "yes",
    answeredBy: ANSWERED_BY.human,
  });
  const row = inboxMessageById("i1");
  assert.equal(row?.status, INBOX_STATUS.answered);
  assert.equal(row?.answerText, "yes");
  assert.equal(row?.draft, null);
});

it("reopenInboxMessage reopens the question, draft included", () => {
  reopenInboxMessage("i1", { draft: '{"q1":"a"}', draftAt: now });
  const row = inboxMessageById("i1");
  assert.equal(row?.status, INBOX_STATUS.open);
  assert.equal(row?.answerText, null);
  assert.equal(row?.draft, '{"q1":"a"}');
});
