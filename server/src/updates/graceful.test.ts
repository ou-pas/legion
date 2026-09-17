// Graceful update. Three tests come from an architecture review that found the first version's
// defect: `runLifecycle` calls `pumpQueue()` in its `finally`, pause included, so each suspended
// session started a new one and the window never converged.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-graceful-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  suspendActiveSessions,
  markSuspendedByUpdate,
  updateSuspensionRefusal,
  resumeUpdatePauses,
} = await import("./graceful.js");
const { WAIT_REASON } = await import("../inbox/wait-reason.js");

const PROJECT = "p1",
  AGENT = "a1",
  RUNNER = "r1";

function reset(): void {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.credentials).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "T", slug: "t", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: "docker" }).run();
}

function session(id: string, status: string): void {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id: `t-${id}`,
      projectId: PROJECT,
      name: id,
      status: "doing",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id,
      taskId: `t-${id}`,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: status as never,
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

function openEntry(id: string, sessionId: string, reason: string): void {
  db.insert(schema.inboxMessages)
    .values({
      id,
      sessionId,
      taskId: `t-${sessionId}`,
      agentId: AGENT,
      kind: "text",
      body: "b",
      status: "open",
      reason: reason as never,
      createdAt: new Date(),
    })
    .run();
}

describe("suspendActiveSessions", () => {
  beforeEach(() => reset());

  it("returns immediately when nothing runs", async () => {
    assert.deepEqual(await suspendActiveSessions({ timeoutMs: 50, pollMs: 5 }), {
      ok: true,
      suspended: [],
    });
  });

  it("raises the pause flag on every active session", async () => {
    session("s1", "running");
    session("s2", "running");
    // Short timeout: this checks the REQUEST, not the stop, which the (absent) runtime honours.
    const res = await suspendActiveSessions({ timeoutMs: 30, pollMs: 5 });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.deepEqual(res.stillRunning.sort(), ["s1", "s2"]);
  });

  it("CLEARS the flag when the timeout expires, or the fleet would stop for nothing", async () => {
    session("s1", "running");
    await suspendActiveSessions({ timeoutMs: 30, pollMs: 5 });
    const row = db.select({ p: schema.sessions.pauseRequested }).from(schema.sessions).all()[0];
    assert.ok(!row?.p, "the flag must be cleared");
  });

  it("counts ONLY occupying statuses: a paused session is no longer in flight", async () => {
    session("s1", "waiting");
    session("s2", "destroyed");
    assert.deepEqual(await suspendActiveSessions({ timeoutMs: 50, pollMs: 5 }), {
      ok: true,
      suspended: [],
    });
  });

  it("closes the queue DURING the window, and reopens it after", async () => {
    assert.equal(updateSuspensionRefusal(), null, "nothing blocks at rest");
    session("s1", "running");
    const during: (string | null)[] = [];
    const p = suspendActiveSessions({ timeoutMs: 40, pollMs: 5 });
    await new Promise((r) => setTimeout(r, 10));
    during.push(updateSuspensionRefusal());
    await p;
    assert.ok(during[0], "the queue must be closed during the window");
    assert.equal(updateSuspensionRefusal(), null, "and reopened after, even on failure");
  });
});

describe("markSuspendedByUpdate", () => {
  beforeEach(() => reset());

  it("marks only OPEN pauses of the named sessions", () => {
    session("s1", "waiting");
    session("s2", "waiting");
    openEntry("i1", "s1", WAIT_REASON.operatorPause);
    openEntry("i2", "s2", WAIT_REASON.operatorPause);
    assert.equal(markSuspendedByUpdate(["s1"]), 1);
    const reasons = db
      .select({ id: schema.inboxMessages.id, r: schema.inboxMessages.reason })
      .from(schema.inboxMessages)
      .all();
    assert.equal(reasons.find((x) => x.id === "i1")?.r, WAIT_REASON.updatePause);
    assert.equal(
      reasons.find((x) => x.id === "i2")?.r,
      WAIT_REASON.operatorPause,
      "a session we did not suspend keeps its reason",
    );
  });

  // The body lied (14/09): `pauseForOperator` says "Paused at your request … Answer this entry to
  // resume" without knowing why; during an update the operator asked nothing, and answering by hand
  // would restart against images still rebuilding. Reason and body change together.
  it("rewrites the body with the reason: the entry no longer speaks of an operator request", () => {
    session("s1", "waiting");
    openEntry("i1", "s1", WAIT_REASON.operatorPause);
    markSuspendedByUpdate(["s1"]);
    const body = db.select().from(schema.inboxMessages).all()[0]?.body ?? "";
    assert.ok(!body.includes("at your request"), body);
    assert.ok(body.includes("update"), body);
  });

  it("does not touch a QUESTION asked by the agent", () => {
    // It awaits a real answer: waking it would answer in the human's place.
    session("s1", "waiting");
    openEntry("i1", "s1", WAIT_REASON.question);
    assert.equal(markSuspendedByUpdate(["s1"]), 0);
  });
});

describe("resumeUpdatePauses", () => {
  beforeEach(() => reset());

  it("resumes NOTHING while the update is in flight", async () => {
    // The new control plane is up while fleet images still rebuild (04/09 outage).
    session("s1", "waiting");
    openEntry("i1", "s1", WAIT_REASON.updatePause);
    assert.equal(await resumeUpdatePauses(async () => true), 0);
    assert.equal(db.select().from(schema.inboxMessages).all()[0]?.status, "open");
  });

  it("resumes only the update reason, never a pause the human asked for", async () => {
    session("s1", "waiting");
    session("s2", "waiting");
    openEntry("i1", "s1", WAIT_REASON.updatePause);
    openEntry("i2", "s2", WAIT_REASON.operatorPause);
    assert.equal(await resumeUpdatePauses(async () => false), 1);
  });
});
