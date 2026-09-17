// Reads and writes behind `inbox-draft.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-draft-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { inboxDraftRowById, writeDraft } = await import("./inbox-draft-store.js");
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
  .values({
    id: "i1",
    sessionId: "s1",
    taskId: "t1",
    agentId: "a1",
    kind: INBOX_KIND.form,
    body: "?",
    form: JSON.stringify({ blocks: [] }),
    status: INBOX_STATUS.open,
    createdAt: now,
  })
  .run();

it("inboxDraftRowById reads status, form and session", () => {
  const row = inboxDraftRowById("i1");
  assert.equal(row?.status, INBOX_STATUS.open);
  assert.equal(row?.sessionId, "s1");
});

it("writeDraft writes the draft and its timestamp", () => {
  writeDraft("i1", JSON.stringify({ q1: "yes" }));
  const stored = db.select().from(schema.inboxMessages).all()[0];
  assert.equal(stored?.draft, JSON.stringify({ q1: "yes" }));
  assert.ok(stored?.draftAt);
});
