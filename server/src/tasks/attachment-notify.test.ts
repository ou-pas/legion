// Three files dropped at once = one message to the agent (07/09, operator's remark: "if we send 3
// files, do we steer 3 times?"). The runner drains its queue in milliseconds, so grouping afterwards
// is not enough: the message is held while the burst passes, then made into one.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-attachment-notify-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { flushAttachmentNotices, notifyAttachment, pendingAttachmentNotices } =
  await import("./attachment-notify.js");
const { takePendingSteers } = await import("../sessions/steering.js");
const { attachmentSteerText } = await import("./attachments.js");

const SESSION = "s-live";
const file = (name: string) => ({
  name,
  size: 12,
  mimeType: "image/png",
  kind: "image" as const,
  path: `/artifacts/t1/attachments/${name}`,
});

function resetBase() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: "p1", name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: "a1", projectId: "p1", name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: "r1", name: "r1", kind: "process" }).run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: "p1",
      name: "t",
      status: "doing",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status: "running",
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

describe("notifyAttachment: a burst of drops, one message", () => {
  beforeEach(() => {
    flushAttachmentNotices();
    resetBase();
  });

  it("holds the message: nothing queued until the delay passes", () => {
    notifyAttachment(SESSION, file("a.png"), 60_000);
    assert.equal(takePendingSteers(SESSION).length, 0);
    assert.equal(pendingAttachmentNotices(SESSION), 1);
  });

  it("three drops during the window = one steer naming the three paths", () => {
    notifyAttachment(SESSION, file("a.png"), 60_000);
    notifyAttachment(SESSION, file("b.png"), 60_000);
    notifyAttachment(SESSION, file("c.png"), 60_000);
    flushAttachmentNotices(SESSION);
    const steers = takePendingSteers(SESSION);
    assert.equal(steers.length, 1);
    for (const n of ["a.png", "b.png", "c.png"])
      assert.match(steers[0]?.text ?? "", new RegExp(`/artifacts/t1/attachments/${n}`));
    assert.equal(pendingAttachmentNotices(SESSION), 0);
  });

  it("the elapsed delay sends the message on its own", async () => {
    notifyAttachment(SESSION, file("a.png"), 20);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(takePendingSteers(SESSION).length, 1);
  });

  it("a session that ended meanwhile: the message is dropped, without throwing", () => {
    notifyAttachment(SESSION, file("a.png"), 60_000);
    db.update(schema.sessions).set({ status: "destroyed" }).run();
    assert.doesNotThrow(() => flushAttachmentNotices(SESSION));
    assert.equal(takePendingSteers(SESSION).length, 0);
  });

  it("the same file dropped again during the window is cited once", () => {
    notifyAttachment(SESSION, file("a.png"), 60_000);
    notifyAttachment(SESSION, file("a.png"), 60_000);
    flushAttachmentNotices(SESSION);
    const text = takePendingSteers(SESSION)[0]?.text ?? "";
    assert.equal(text.split("/artifacts/t1/attachments/a.png").length - 1, 1);
  });
});

describe("attachmentSteerText: one file or several, same language", () => {
  it("one: the original sentence, path and fs_read", () => {
    const text = attachmentSteerText([file("a.png")]);
    assert.match(text, /OPERATOR/);
    assert.match(text, /\/artifacts\/t1\/attachments\/a\.png/);
    assert.match(text, /fs_read/);
  });

  it("several: the count, then one line per file with its path", () => {
    const text = attachmentSteerText([file("a.png"), file("b.md")]);
    assert.match(text, /2 files/);
    assert.match(text, /- a\.png .*\/artifacts\/t1\/attachments\/a\.png/);
    assert.match(text, /- b\.md .*\/artifacts\/t1\/attachments\/b\.md/);
  });
});
