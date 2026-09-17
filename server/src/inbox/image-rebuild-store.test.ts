// Persistence behind `image-rebuild.ts`. Two filters: an open rebuild question is told apart by its
// `image_rebuild` column, and a vanished task leaves no hole in `taskNames`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-image-rebuild-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { openImageRebuildQuestions, taskNames } = await import("./image-rebuild-store.js");
const { INBOX_KIND, INBOX_STATUS, ON_ANSWER } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "p1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "r1", kind: RUNNER_KIND.docker }).run();
for (const id of ["t1", "t2"])
  db.insert(schema.tasks)
    .values({ id, projectId: "p1", name: `task ${id}`, createdAt: now, updatedAt: now })
    .run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "m",
    status: "failed",
    callbackToken: "tok",
    mock: true,
    startedAt: now,
  })
  .run();

function inbox(id: string, over: Partial<typeof schema.inboxMessages.$inferInsert>) {
  db.insert(schema.inboxMessages)
    .values({
      id,
      sessionId: "s1",
      taskId: "t1",
      agentId: "a1",
      kind: INBOX_KIND.choice,
      body: "b",
      status: INBOX_STATUS.open,
      onAnswer: ON_ANSWER.rebuildImage,
      createdAt: now,
      ...over,
    })
    .run();
}

it("openImageRebuildQuestions returns only rebuild questions still open", () => {
  inbox("i-open", { imageRebuild: JSON.stringify({ runnerId: "r1", image: "img" }) });
  inbox("i-closed", {
    status: INBOX_STATUS.closed,
    imageRebuild: JSON.stringify({ runnerId: "r1", image: "img" }),
  });
  inbox("i-other", { onAnswer: ON_ANSWER.resume, imageRebuild: null });

  const ids = openImageRebuildQuestions().map((r) => r.id);
  assert.deepEqual(ids, ["i-open"]);
});

it("taskNames returns names, dropping a vanished task instead of leaving a hole", () => {
  assert.deepEqual(taskNames(["t1", "t2"]), ["task t1", "task t2"]);
  assert.deepEqual(taskNames(["t1", "never-existed"]), ["task t1"]);
  assert.deepEqual(taskNames([]), []);
});
