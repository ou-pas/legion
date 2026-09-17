// On 20/08 a session went `failed` without a single event saying so, leaving diagnosis by
// elimination. `markSessionTerminal` is the lock meant to make that impossible: this file checks the
// lock itself (systematic write + event, mandatory reason); the real call paths
// (recoverOrphanSessions, reapDeadSessions, runLifecycle, stopSession) are covered in
// runner/manager.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-session-terminal-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { markSessionTerminal, TERMINAL_STATUSES } = await import("./session-terminal.js");
const { subscribe } = await import("../shared/events.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";
const TASK = "t1";
const SESSION = "s1";

function seedFixtures() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "T", slug: "t", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r", kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: PROJECT,
      name: "t",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: TASK,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: "running",
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

const sessionRow = () =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, SESSION)).get();
const events = () =>
  db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, SESSION)).all();

describe("markSessionTerminal", () => {
  beforeEach(() => seedFixtures());

  for (const status of TERMINAL_STATUSES) {
    it(`"${status}" sets the status AND publishes a "status" event carrying the reason`, () => {
      markSessionTerminal(SESSION, status, "test reason");
      const row = sessionRow();
      assert.equal(row?.status, status);
      assert.ok(row?.endedAt, "endedAt must be set: a terminal session has an end");
      // v22: the reason ALSO lives on the row, so whoever arrives later does not replay the trace.
      assert.equal(row?.endReason, "test reason");

      const statusEvents = events().filter((e) => e.type === "status");
      assert.equal(statusEvents.length, 1);
      const payload = JSON.parse(statusEvents[0]!.payload) as { status: string; reason: string };
      assert.equal(payload.status, status);
      assert.equal(payload.reason, "test reason");
    });
  }

  it("refuses an empty reason: a caller bug, not a case for a default", () => {
    assert.throws(() => markSessionTerminal(SESSION, "failed", ""));
    assert.throws(() => markSessionTerminal(SESSION, "failed", "   "));
    // Nothing moved: a refused call must leave NO partial trace (no status without event, no event
    // without a real reason).
    assert.equal(sessionRow()?.status, "running");
    assert.equal(sessionRow()?.endReason, null);
    assert.equal(events().length, 0);
  });

  it("`extra` adds to the payload without ever overwriting `status`/`reason`", () => {
    markSessionTerminal(SESSION, "failed", "the real reason", {
      status: "destroyed",
      reason: "usurped",
      exitCode: 1,
    });
    const payload = JSON.parse(events().find((e) => e.type === "status")!.payload) as {
      status: string;
      reason: string;
      exitCode: number;
    };
    assert.equal(payload.status, "failed");
    assert.equal(payload.reason, "the real reason");
    assert.equal(payload.exitCode, 1);
  });

  it("publishes AFTER setting the status in the database: a live subscriber never sees the event early", () => {
    let statusWhenPublished: string | undefined;
    const unsubscribe = subscribe(SESSION, () => {
      statusWhenPublished = sessionRow()?.status;
    });
    markSessionTerminal(SESSION, "destroyed", "order checked");
    unsubscribe();
    assert.equal(statusWhenPublished, "destroyed");
  });
});
