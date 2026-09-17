// The event bus's database access. What matters is duplicate refusal: the unique
// (session_id, seq) index must return `changes: 0` without throwing, which makes runtime resends
// free (see `events.ts`).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-events-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("./db.js");
const { bumpSessionEventCount, insertSessionEvent, maxSeqOf, sessionEventRows } =
  await import("./events-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "T1",
    status: "todo",
    boardOrder: 0,
    createdAt: now,
    updatedAt: now,
  })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "local", kind: "docker" }).run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "m",
    callbackToken: "tok",
    status: "running",
    startedAt: now,
  })
  .run();

const event = (seq: number | null, type: string) => ({
  sessionId: "s1",
  seq,
  type,
  payload: "{}",
  createdAt: now,
});

describe("events-store", () => {
  it("has no seq for a session that said nothing", () => {
    assert.equal(maxSeqOf("s1"), null);
  });

  it("inserts, returns the row id, and tracks the highest seq", () => {
    const first = insertSessionEvent(event(1, "init"));
    assert.equal(first.changes, 1);
    assert.ok(Number(first.lastInsertRowid) > 0);
    insertSessionEvent(event(2, "text"));
    assert.equal(maxSeqOf("s1"), 2);
  });

  it("writes nothing and does not throw for a repeated seq", () => {
    const again = insertSessionEvent(event(2, "text"));
    assert.equal(again.changes, 0);
    assert.equal(sessionEventRows("s1", 0).length, 2);
  });

  it("replays the whole trace, or only what follows an id", () => {
    const all = sessionEventRows("s1", 0);
    assert.deepEqual(
      all.map((r) => r.type),
      ["init", "text"],
    );
    const after = sessionEventRows("s1", all[0]!.id);
    assert.deepEqual(
      after.map((r) => r.type),
      ["text"],
    );
  });

  it("increments the session's event count", () => {
    bumpSessionEventCount("s1");
    const row = db.select().from(schema.sessions).all()[0]!;
    assert.equal(row.eventCount, 1);
  });
});
