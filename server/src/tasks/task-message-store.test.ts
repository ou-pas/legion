// The target task, the live session that would absorb the message by steering, and filing the
// message in the activity feed. Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-message-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { activeSessionsOf, findTaskRow, recordMessageActivity } =
  await import("./task-message-store.js");
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
  .values([
    {
      id: "s-running",
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: now,
    },
    {
      id: "s-dead",
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "sonnet",
      status: "destroyed",
      callbackToken: "tok",
      startedAt: now,
    },
  ])
  .run();

describe("findTaskRow", () => {
  it("returns the row, or undefined", () => {
    assert.equal(findTaskRow("t1")?.name, "with session");
    assert.equal(findTaskRow("never-seen"), undefined);
  });
});

describe("activeSessionsOf", () => {
  it("returns only active sessions, never finished ones", () => {
    assert.deepEqual(
      activeSessionsOf("t1").map((s) => s.id),
      ["s-running"],
    );
    assert.deepEqual(activeSessionsOf("t2"), []);
  });
});

describe("recordMessageActivity", () => {
  it("files the message in the task's activity feed", () => {
    recordMessageActivity("t1", "human", "a message");
    const rows = db.select().from(schema.taskActivity).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.taskId, "t1");
    assert.equal(rows[0]?.from, "human");
    assert.equal(rows[0]?.body, "a message");
  });
});
