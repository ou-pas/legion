// A closed question is not an answered one: `closed` says nobody answered because the session died
// waiting. Confusing it with `answered` would suggest a decision never taken.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-close-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { closeInboxOfDeadSessions, closeSessionInbox } = await import("./session-close.js");
const { INBOX_KIND, INBOX_STATUS } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

// Minimal fixture: foreign keys are on, so an inbox entry needs a session, task, agent and project.
const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P", slug: "p", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "agent", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "r1", kind: RUNNER_KIND.process }).run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "task",
    status: TASK_STATUS.doing,
    assigneeAgentId: "a1",
    createdAt: now,
    updatedAt: now,
  })
  .run();
for (const id of ["s1", "s2"])
  db.insert(schema.sessions)
    .values({
      id,
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status: "waiting",
      callbackToken: id,
      mock: true,
      startedAt: now,
    })
    .run();

function entry(id: string, sessionId: string, status: "open" | "answered"): void {
  db.insert(schema.inboxMessages)
    .values({
      id,
      sessionId,
      taskId: "t1",
      agentId: "a1",
      kind: INBOX_KIND.text,
      body: id,
      status,
      createdAt: now,
    })
    .run();
}

const statusOf = (id: string) =>
  db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, id)).get()?.status;

describe("closeSessionInbox", () => {
  it("catch-up (08/09): closes an open question of a terminal session, keeps a waiting session's", () => {
    // Seen in production: the out-of-quota notice of a session killed by the sweep stayed open,
    // its wake button answering "session is destroyed".
    db.insert(schema.sessions)
      .values({
        id: "s-dead",
        taskId: "t1",
        agentId: "a1",
        runnerId: "r1",
        model: "m",
        status: "destroyed",
        callbackToken: "s-dead",
        mock: true,
        startedAt: now,
      })
      .run();
    entry("q-dead", "s-dead", "open");
    entry("q-waiting", "s1", "open");
    assert.equal(closeInboxOfDeadSessions(), 1);
    assert.equal(statusOf("q-dead"), INBOX_STATUS.closed);
    assert.equal(statusOf("q-waiting"), INBOX_STATUS.open);
    // Idempotent: a second pass finds nothing.
    assert.equal(closeInboxOfDeadSessions(), 0);
  });

  it("closes the session's open questions and only those", () => {
    entry("i-open", "s1", "open");
    entry("i-answered", "s1", "answered");
    entry("i-other", "s2", "open");

    closeSessionInbox("s1");

    assert.equal(statusOf("i-open"), INBOX_STATUS.closed);
    assert.equal(statusOf("i-answered"), INBOX_STATUS.answered, "a given answer is not rewritten");
    assert.equal(statusOf("i-other"), INBOX_STATUS.open, "another session is not affected");
  });

  it("is idempotent: a second stop changes nothing", () => {
    closeSessionInbox("s1");
    assert.equal(statusOf("i-open"), INBOX_STATUS.closed);
    assert.equal(statusOf("i-answered"), INBOX_STATUS.answered);
  });
});
