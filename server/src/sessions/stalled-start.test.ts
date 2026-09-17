// The safety net set on 25/08 after two ghost sessions:
//
//  1. The rule is narrow. Only `starting` sessions WITHOUT a container handle and older than the
//     threshold are collected. A recent start, a `starting` that has its container, a `running`: not
//     touched. That keeps this sweep from killing a session being born, the race
//     `recoverOrphanSessions` protects.
//  2. The session dies saying why: `failed` with a persisted reason, never a silent status
//     (session-terminal.ts contract).
//  3. The task goes to parking, not the queue: `later`, because `todo` would relaunch it on the
//     next tick against the same dead Docker. And only if still `doing`: a human who already moved it
//     keeps control.
//  4. The operator is told: a notice names the task and what to check.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "./session-terminal.js";
import type { TaskStatus } from "../tasks/lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-stalled-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { STALLED_START_MS, stalledStarts, sweepStalledStarts } = await import("./stalled-start.js");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.notices).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "agent",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.docker }).run();
}

function makeTask(id: string, status: TaskStatus = TASK_STATUS.doing) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function makeSession(
  id: string,
  taskId: string,
  opts: { status?: SessionStatus; handle?: string | null; ageMs?: number } = {},
) {
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: opts.status ?? "starting",
      runtimeHandle: opts.handle ?? null,
      callbackToken: "tok",
      mock: true,
      startedAt: new Date(Date.now() - (opts.ageMs ?? 0)),
    })
    .run();
}

beforeEach(reset);

describe("stalledStarts: the selection rule", () => {
  const old = new Date(Date.now() - 10 * 60_000);
  const fresh = new Date(Date.now() - 5_000);

  it("keeps a starting without container and old enough", () => {
    const rows = [{ id: "s1", status: "starting", runtimeHandle: null, startedAt: old }];
    assert.deepEqual(
      stalledStarts(rows, Date.now()).map((s) => s.id),
      ["s1"],
    );
  });

  it("spares a RECENT start: latency, not a failure", () => {
    const rows = [{ id: "s1", status: "starting", runtimeHandle: null, startedAt: fresh }];
    assert.deepEqual(stalledStarts(rows, Date.now()), []);
  });

  it("spares a starting that ALREADY has its container", () => {
    const rows = [
      { id: "s1", status: "starting", runtimeHandle: "legion-session-s1", startedAt: old },
    ];
    assert.deepEqual(stalledStarts(rows, Date.now()), []);
  });

  it("ignores other statuses: running is reapDeadSessions's domain", () => {
    const rows = [
      { id: "s1", status: "running", runtimeHandle: null, startedAt: old },
      { id: "s2", status: SESSION_STATUS.waiting, runtimeHandle: null, startedAt: old },
    ];
    assert.deepEqual(stalledStarts(rows, Date.now()), []);
  });

  it('the threshold is an INCLUSIVE bound, not "strictly older"', () => {
    const now = Date.now();
    const rows = [
      {
        id: "s1",
        status: "starting",
        runtimeHandle: null,
        startedAt: new Date(now - STALLED_START_MS),
      },
    ];
    assert.equal(stalledStarts(rows, now).length, 1);
  });
});

describe("sweepStalledStarts: what it really does", () => {
  it("stops the session with a reason, and persists it", async () => {
    makeTask("t1");
    makeSession("s1", "t1", { ageMs: 10 * 60_000 });
    assert.equal(await sweepStalledStarts(), 1);
    const s = db.select().from(schema.sessions).where(eq(schema.sessions.id, "s1")).get()!;
    assert.equal(s.status, "failed");
    assert.match(s.endReason ?? "", /no container/i);
    assert.ok(s.endedAt, "endedAt must be set");
  });

  it("publishes a status event: never a silent death", async () => {
    makeTask("t1");
    makeSession("s1", "t1", { ageMs: 10 * 60_000 });
    await sweepStalledStarts();
    const events = db
      .select()
      .from(schema.sessionEvents)
      .where(eq(schema.sessionEvents.sessionId, "s1"))
      .all();
    const status = events.filter((e) => e.type === "status");
    assert.equal(status.length, 1);
    const payload = JSON.parse(status[0]!.payload) as {
      status: string;
      reason: string;
      stalledStart?: boolean;
    };
    assert.equal(payload.status, "failed");
    assert.equal(payload.stalledStart, true);
    assert.ok(payload.reason.length > 0);
  });

  it("parks the task in later, not in the queue, which would relaunch it in a loop", async () => {
    makeTask("t1");
    makeSession("s1", "t1", { ageMs: 10 * 60_000 });
    await sweepStalledStarts();
    assert.equal(
      db.select().from(schema.tasks).where(eq(schema.tasks.id, "t1")).get()!.status,
      TASK_STATUS.later,
    );
  });

  it("does NOT touch a task a human already moved", async () => {
    makeTask("t1", TASK_STATUS.review);
    makeSession("s1", "t1", { ageMs: 10 * 60_000 });
    await sweepStalledStarts();
    assert.equal(
      db.select().from(schema.tasks).where(eq(schema.tasks.id, "t1")).get()!.status,
      TASK_STATUS.review,
    );
  });

  it("leaves a notice that NAMES the task and says what to check", async () => {
    makeTask("t1");
    makeSession("s1", "t1", { ageMs: 10 * 60_000 });
    await sweepStalledStarts();
    const notices = db.select().from(schema.notices).all();
    assert.equal(notices.length, 1);
    assert.match(notices[0]!.body, /task t1/);
    assert.match(notices[0]!.body, /Docker/);
    assert.match(notices[0]!.body, /saved for later/);
  });

  it("does nothing when nothing is stuck, and costs nothing per tick", async () => {
    makeTask("t1");
    makeSession("s1", "t1", { ageMs: 5_000 });
    assert.equal(await sweepStalledStarts(), 0);
    assert.equal(
      db.select().from(schema.sessions).where(eq(schema.sessions.id, "s1")).get()!.status,
      "starting",
    );
    assert.equal(
      db.select().from(schema.tasks).where(eq(schema.tasks.id, "t1")).get()!.status,
      TASK_STATUS.doing,
    );
  });
});
