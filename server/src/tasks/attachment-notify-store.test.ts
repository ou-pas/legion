// The status of the session to notify. Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-attachment-notify-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { sessionStatusOf } = await import("./attachment-notify-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "mini", kind: "process" }).run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "task",
    status: TASK_STATUS.doing,
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
    model: "sonnet",
    status: "running",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();

describe("sessionStatusOf", () => {
  it("returns the session's status", () => {
    assert.equal(sessionStatusOf("s1"), "running");
  });

  it("returns `undefined` for an unknown session", () => {
    assert.equal(sessionStatusOf("never-seen"), undefined);
  });
});
