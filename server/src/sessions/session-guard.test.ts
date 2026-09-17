// Blocked is not waiting (slice nav/11).
//
//  AC#1: an APPROVAL request stops the session on `blocked`, an ordinary question leaves it
//  `waiting`, and an already settled session keeps its status: rebuilding after the fact which ones
//  were gates would be invention.
//
//  AC#2: the invariant holds at the SOURCE. It is tested not through a route or a given caller but
//  on the write gesture itself (`enqueueSteer`) and the guard it calls: that is where it must hold to
//  also hold for a path that does not exist yet. And it NAMES its reason: an automatic loop retries
//  a silent refusal.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-blocked-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const { BLOCKED_WRITE_REFUSAL, BlockedSessionError, assertSessionWritable, blockedWriteRefusal } =
  await import("./session-guard.js");
const { enqueueSteer, pendingSteerCount, steerRefusal } = await import("./steering.js");
const { createInboxMessage } = await import("../inbox/inbox.js");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p-blk",
  A = "a-blk",
  T = "t-blk",
  R = "r-blk";
const now = new Date();

/** A clean database per test, and real sessions: foreign keys are on, so the setup is complete or
 *  it fails. */
function reset(): void {
  db.delete(schema.sessionSteers).run();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p-blk", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "ag", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.tasks)
    .values({
      id: T,
      projectId: P,
      name: "t",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: R, name: "local", kind: RUNNER_KIND.docker }).run();
}

function session(id: string, status = "running"): string {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: T,
      agentId: A,
      runnerId: R,
      status: status as "running",
      model: "sonnet",
      callbackToken: `tok-${id}`,
      startedAt: now,
    })
    .run();
  return id;
}

const statusOf = (id: string) =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()!.status;

beforeEach(reset);

describe("AC#1: an approval gate carries `blocked`, a question stays `waiting`", () => {
  it("`approval` stops the session on a decision", () => {
    createInboxMessage(session("s-gate"), {
      kind: "text",
      body: "I need to delete the exports bucket. May I?",
      approval: true,
    });
    assert.equal(statusOf("s-gate"), "blocked");
  });

  it("without `approval`, an ordinary question stays a wait for an answer", () => {
    createInboxMessage(session("s-ask"), { kind: "text", body: "Which format for the export?" });
    assert.equal(statusOf("s-ask"), SESSION_STATUS.waiting);
  });

  it("a WAIT cannot be an approval: nobody has anything to approve", () => {
    // `wait_for_task` and the out-of-quota pause wake up ON THEIR OWN. A caller passing `approval` on
    // either would be wrong, and blocking the session would make it impossible to wake automatically:
    // the write guard would refuse the wake-up.
    const other = "t-other";
    db.insert(schema.tasks)
      .values({ id: other, projectId: P, name: "o", createdAt: now, updatedAt: now })
      .run();
    createInboxMessage(session("s-wait"), {
      kind: "text",
      body: "waiting",
      approval: true,
      waitForTaskId: other,
    });
    assert.equal(statusOf("s-wait"), SESSION_STATUS.waiting);

    createInboxMessage(session("s-quota"), {
      kind: "text",
      body: "out of quota",
      approval: true,
      wakeAt: new Date(Date.now() + 60_000),
    });
    assert.equal(statusOf("s-quota"), SESSION_STATUS.waiting);
  });

  it("existing sessions keep their status: no retroactive reconstruction", () => {
    // What matters for existing data: a session already in `waiting` before this slice is NOT reread
    // to guess whether it was a gate. Guessing would be inventing an archive.
    session("s-old", SESSION_STATUS.waiting);
    createInboxMessage(session("s-new"), {
      kind: "text",
      body: "may I push?",
      approval: true,
    });
    assert.equal(
      statusOf("s-old"),
      SESSION_STATUS.waiting,
      "an earlier session does not change status",
    );
    assert.equal(statusOf("s-new"), "blocked");
  });

  it("a blocked session stays READABLE and alive", () => {
    createInboxMessage(session("s-live"), { kind: "text", body: "may I?", approval: true });
    const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, "s-live")).get()!;
    assert.equal(row.endedAt, null, "stopped is not finished: no end date");
    assert.equal(row.endReason, null);
  });
});

describe("AC#2: no automatic write into a blocked session, and the refusal names itself", () => {
  it("the write gesture itself refuses, not only the route", () => {
    // The guard is IN `enqueueSteer`, which makes it hold for a caller unaware of the distinction:
    // no route is called here, no prior check.
    createInboxMessage(session("s-1"), { kind: "text", body: "may I?", approval: true });
    assert.throws(
      () => enqueueSteer("s-1", "carry on anyway", "system"),
      (err: unknown) => err instanceof BlockedSessionError && err.message === BLOCKED_WRITE_REFUSAL,
    );
    assert.equal(pendingSteerCount("s-1"), 0, "nothing may have been queued");
  });

  it("the refusal NAMES the reason instead of returning a boolean", () => {
    createInboxMessage(session("s-2"), { kind: "text", body: "may I?", approval: true });
    const refusal = blockedWriteRefusal("s-2", "system");
    assert.ok(refusal, "a refusal is expected");
    assert.match(refusal, /decision/i);
    assert.match(refusal, /automation/i);
  });

  it("a caller that does not name itself is treated as automation", () => {
    // The default is "system" on purpose: a write path written tomorrow by someone unaware of `blocked`
    // will not pass because it forgot to declare itself.
    createInboxMessage(session("s-3"), { kind: "text", body: "may I?", approval: true });
    assert.throws(() => assertSessionWritable("s-3"), BlockedSessionError);
  });

  it("the human passes: their decision is exactly what unblocks", () => {
    createInboxMessage(session("s-4"), { kind: "text", body: "may I?", approval: true });
    assert.equal(blockedWriteRefusal("s-4", "human"), null);
  });

  it("other statuses are untouched: the guard only speaks of `blocked`", () => {
    session("s-run");
    createInboxMessage(session("s-quest"), { kind: "text", body: "which format?" });
    assert.equal(blockedWriteRefusal("s-run", "system"), null);
    assert.equal(
      blockedWriteRefusal("s-quest", "system"),
      null,
      "a question stays answerable by the system",
    );
    assert.equal(enqueueSteer("s-run", "go right", "system").text, "go right");
  });

  it("and the steering HTTP refusal names the state too", () => {
    // Two different questions, two guards: this one answers "the runtime no longer listens" (the
    // container is destroyed), and it applies to human and system alike.
    const refusal = steerRefusal("blocked");
    assert.equal(refusal?.status, 409);
    assert.match(refusal?.error ?? "", /approval/i);
  });
});
