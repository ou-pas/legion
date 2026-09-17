// Does a live session exist for a task, among those the caller's `isLive` predicate would keep.
// Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-serialize-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { hasLiveSession } = await import("./task-serialize-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: P, name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "mini", kind: "process" }).run();
db.insert(schema.tasks)
  .values([
    {
      id: "t1",
      projectId: P,
      name: "with session",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "t2",
      projectId: P,
      name: "without session",
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "sonnet",
    status: "destroyed",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();

const isLive = (status: string) => status !== "destroyed" && status !== "failed";

describe("hasLiveSession", () => {
  it("depends entirely on the caller's `isLive` predicate", () => {
    assert.equal(hasLiveSession("t1", isLive), false, "destroyed is not live");
    assert.equal(
      hasLiveSession("t1", () => true),
      true,
      "a predicate accepting everything accepts",
    );
  });

  it("returns `false` for a task with no session at all", () => {
    assert.equal(hasLiveSession("t2", isLive), false);
  });
});
