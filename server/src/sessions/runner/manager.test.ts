// On 20/08 a session went `failed` without a single event saying so: `recoverOrphanSessions` set
// the status in the database and published NOTHING. Every terminal-status writer now goes through
// `markSessionTerminal` (session-terminal.ts), the only place allowed to set `destroyed`/`failed`,
// which REQUIRES a reason.
//
// This file does not retest that lock (see session-terminal.test.ts): it checks that EACH real
// terminal path of the manager (the five writes that existed before centralisation) goes through
// it, by observing that an explanatory event exists afterwards. No Docker mock, with one
// exception: test runners are `kind: process`, or `kind: docker` without `runtimeHandle` (the
// Docker probe is skipped by construction, see `reapDeadSessions` in recovery.ts). The exception
// (07/09) is the probe TRACE test, which puts a fake `docker` on the PATH like
// docker-exec.test.ts, because that process's output is what must show up in the end reason.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "../session-terminal.js";
import type { RunnerKind } from "../../shared/enums.js";

const dir = mkdtempSync(join(tmpdir(), "legion-manager-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { probeVerdict } = await import("../../shared/docker-exec.js");
const { recoverOrphanSessions, reapDeadSessions, runLifecycle, stopSession } =
  await import("./manager.js");
// The runtime port is wired by `index.ts` in production; a test must do it itself. Here it is
// PRODUCTION being wired, without a double: this file's runners are `kind: process`, so
// `stopSession` destroys a ProcessRunner without a handle, no Docker.
const { wireRealRunner } = await import("./test-wiring.js");
wireRealRunner();
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";

function resetBase() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "T", slug: "t", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
}

function makeRunnerRow(id: string, kind: RunnerKind) {
  db.insert(schema.runners).values({ id, name: id, kind }).run();
}

function makeTask(id: string) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: id,
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function makeSession(id: string, taskId: string, runnerId: string, status: SessionStatus) {
  const now = new Date();
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: AGENT,
      runnerId,
      model: "m",
      status,
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

const sessionRow = (id: string) =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();
const events = (id: string) =>
  db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, id)).all();

/** Not ONE specific event type (run_error vs status) but the general promise: afterwards, a
 *  readable reason exists in the trace. Exactly what was missing on 20/08. */
function hasExplanation(id: string): boolean {
  return events(id).some((e) => {
    try {
      const payload = JSON.parse(e.payload) as { reason?: unknown; message?: unknown };
      const text = payload.reason ?? payload.message;
      return typeof text === "string" && text.trim().length > 0;
    } catch {
      return false;
    }
  });
}

// Minimal but complete SessionSpec: runLifecycle tests never go through buildSpec (too many
// dependencies: real agents/projects/secrets), so it is built by hand.
function makeSpec(
  overrides: Partial<import("./types.js").SessionSpec>,
): import("./types.js").SessionSpec {
  return {
    sessionId: "x",
    callbackUrl: "http://localhost:8790",
    callbackToken: "tok",
    model: "m",
    effort: null,
    thinking: null,
    taskId: "x",
    taskName: "t",
    fallbackCommitSubject: "chore: t",
    taskDescription: "d",
    agentName: "a",
    rolePrompt: "r",
    repos: [],
    repoBranch: "legion/x",
    allowedTools: [],
    builtinTools: [],
    inboxEnabled: false,
    artifactsPath: "/artifacts/x",
    expectedArtifacts: [],
    attachments: [],
    criteria: null,
    lotRefusal: null,
    goalId: null,
    network: { mode: "open" },
    claudeStateDir: join(dir, "claude"),
    workspaceDir: join(dir, "workspace"),
    packageCacheDir: null,
    image: null,
    sshKeyPath: null,
    sshKnownHostsPath: null,
    rules: [],
    resume: null,
    seqBase: 0,
    mock: false,
    env: {},
    browser: null,
    mcpServers: {},
    skills: [],
    gitAuthor: { name: "Legion", email: "legion@local" },
    ...overrides,
  };
}

function fakeRunner(impl: Partial<import("./types.js").Runner> = {}): import("./types.js").Runner {
  return {
    kind: RUNNER_KIND.process,
    provision: async (spec) => ({ id: spec.sessionId, runtime: "fake-runtime" }),
    wait: async () => ({ exitCode: 0 }),
    destroy: async () => {},
    ...impl,
  };
}

describe("recoverOrphanSessions: terminal path 1/5", () => {
  beforeEach(() => resetBase());

  it("an active session in the database whose runner is not docker: judged orphaned, and says so", async () => {
    const id = "s-orphan",
      taskId = "t-orphan",
      runnerId = "r-np";
    makeRunnerRow(runnerId, "process");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "running");

    await recoverOrphanSessions();

    const row = sessionRow(id);
    assert.equal(row?.status, "failed");
    assert.ok(row?.endedAt);
    assert.ok(hasExplanation(id), "no event explains why the session was judged dead");
  });
});

describe("reapDeadSessions: terminal path 2/5", () => {
  beforeEach(() => resetBase());

  it("container gone without a reported result → failed, and says so", async () => {
    const id = "s-reap-fail",
      taskId = "t-reap-fail",
      runnerId = "r-docker-1";
    makeRunnerRow(runnerId, "docker");
    makeTask(taskId);
    // No runtimeHandle: the Docker probe is skipped by construction, so no external call (see
    // reapDeadSessions in recovery.ts).
    makeSession(id, taskId, runnerId, "running");

    const reaped = await reapDeadSessions();

    assert.equal(reaped, 1);
    const row = sessionRow(id);
    assert.equal(row?.status, "failed");
    assert.ok(hasExplanation(id));
  });

  // 08/09: this test pinned the wrong policy. Written on 07/09 to prove the probe TRACE was kept,
  // it also required `reapDeadSessions() === 1` on an `unknown` verdict, i.e. that a silent probe
  // is a death certificate. That same day session YPOdg3sGWKnA was killed mid fan-out on a
  // `docker inspect` taking 5014 ms, while it had written a file forty seconds earlier. The trace
  // requirement stays; the kill requirement is reversed.
  it("probe without a verdict (ssh exits 255) → the session is KEPT, and the probe is traced", async () => {
    const id = "s-reap-probe",
      taskId = "t-reap-probe",
      runnerId = "r-docker-3";
    makeRunnerRow(runnerId, "docker");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "running");
    db.update(schema.sessions)
      .set({ runtimeHandle: "c6aa86c7d69d" })
      .where(eq(schema.sessions.id, id))
      .run();
    // A fake `docker` on the PATH, as in docker-exec.test.ts: the ssh transport stalls.
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "docker"),
      '#!/bin/sh\necho "ssh: connect to host: Operation timed out" >&2; exit 255\n',
    );
    chmodSync(join(bin, "docker"), 0o755);
    const realPath = process.env.PATH ?? "";
    process.env.PATH = `${bin}:${realPath}`;
    try {
      assert.equal(await reapDeadSessions(), 0, "a probe that did not answer proves no death");
    } finally {
      process.env.PATH = realPath;
    }

    const row = sessionRow(id);
    assert.equal(row?.status, "running", "the session is still running, nothing says otherwise");
    assert.equal(row?.endedAt, null);
    // The probe trace is still required, but it now lives in the control plane log
    // (`logControlEvent`) rather than a death certificate: an infrastructure failure to look at,
    // not a session to bury. `probeVerdict`'s wording does not change.
    assert.match(
      probeVerdict({ verdict: "unknown", code: 255, stderr: "ssh: connect to host", ms: 5014 }),
      /PROBE WITHOUT A VERDICT — code 255 in 5014 ms: ssh: connect/,
    );
  });

  it("a STOPPED container is still killed: proof is the only thing that changed", async () => {
    // The counterpart of the test above: without it, "kill only on proof" could degrade into
    // "never kill" with no assertion failing.
    const id = "s-reap-gone",
      taskId = "t-reap-gone",
      runnerId = "r-docker-4";
    makeRunnerRow(runnerId, "docker");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "running");
    db.update(schema.sessions)
      .set({ runtimeHandle: "c0ffee000000" })
      .where(eq(schema.sessions.id, id))
      .run();
    const bin = join(dir, "bin-gone");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "docker"), '#!/bin/sh\necho "false"\n');
    chmodSync(join(bin, "docker"), 0o755);
    const realPath = process.env.PATH ?? "";
    process.env.PATH = `${bin}:${realPath}`;
    try {
      assert.equal(await reapDeadSessions(), 1);
    } finally {
      process.env.PATH = realPath;
    }
    assert.equal(sessionRow(id)?.status, "failed");
    assert.ok(hasExplanation(id));
  });

  it("container gone AFTER a successful result → destroyed, and says so", async () => {
    const id = "s-reap-ok",
      taskId = "t-reap-ok",
      runnerId = "r-docker-2";
    makeRunnerRow(runnerId, "docker");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "running");
    db.insert(schema.sessionEvents)
      .values({
        sessionId: id,
        type: "result",
        payload: JSON.stringify({ subtype: "success" }),
        createdAt: new Date(),
      })
      .run();

    const reaped = await reapDeadSessions();

    assert.equal(reaped, 1);
    const row = sessionRow(id);
    assert.equal(row?.status, "destroyed");
    assert.ok(hasExplanation(id));
  });
});

describe("runLifecycle: terminal paths 3 and 4 of 5", () => {
  beforeEach(() => resetBase());

  it("normal end, code 0 → destroyed, and says so", async () => {
    const id = "s-ok",
      taskId = "t-ok",
      runnerId = "r-process-1";
    makeRunnerRow(runnerId, "process");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "starting");

    await runLifecycle(
      id,
      taskId,
      fakeRunner({ wait: async () => ({ exitCode: 0 }) }),
      makeSpec({ sessionId: id, taskId }),
    );

    const row = sessionRow(id);
    assert.equal(row?.status, "destroyed");
    assert.ok(hasExplanation(id));
  });

  it("failed end, code != 0 → failed, and says so", async () => {
    const id = "s-fail",
      taskId = "t-fail",
      runnerId = "r-process-2";
    makeRunnerRow(runnerId, "process");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "starting");

    // mock: true avoids the post-failure diagnostic (a real SDK call), off topic here.
    await runLifecycle(
      id,
      taskId,
      fakeRunner({ wait: async () => ({ exitCode: 17 }) }),
      makeSpec({ sessionId: id, taskId, mock: true }),
    );

    const row = sessionRow(id);
    assert.equal(row?.status, "failed");
    assert.ok(hasExplanation(id));
  });

  it("the runtime throws (provision/wait failing) → failed, and says so, not only through run_error", async () => {
    const id = "s-catch",
      taskId = "t-catch",
      runnerId = "r-process-3";
    makeRunnerRow(runnerId, "process");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "starting");

    await runLifecycle(
      id,
      taskId,
      fakeRunner({
        provision: async () => {
          throw new Error("boom: runtime not found");
        },
      }),
      makeSpec({ sessionId: id, taskId, mock: true }),
    );

    const row = sessionRow(id);
    assert.equal(row?.status, "failed");
    assert.ok(
      events(id).some((e) => e.type === "run_error"),
      "the original error message must stay in the trace",
    );
    assert.ok(
      hasExplanation(id),
      "a “status” event with its reason must exist, not only the run_error",
    );
  });
});

describe("stopSession: terminal path 5/5", () => {
  beforeEach(() => resetBase());

  it("operator stop → failed, task sent back to review, open question closed, and says so", async () => {
    const id = "s-stop",
      taskId = "t-stop",
      runnerId = "r-process-4";
    makeRunnerRow(runnerId, "process");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "running");
    db.insert(schema.inboxMessages)
      .values({
        id: "im-1",
        sessionId: id,
        taskId,
        agentId: AGENT,
        kind: "text",
        body: "?",
        status: "open",
        createdAt: new Date(),
      })
      .run();

    await stopSession(id);

    const row = sessionRow(id);
    assert.equal(row?.status, "failed");
    assert.ok(hasExplanation(id));
    assert.equal(
      db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()?.status,
      TASK_STATUS.review,
    );
    assert.equal(
      db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, "im-1")).get()
        ?.status,
      "closed",
    );
  });
});

// The race that killed the first successful pause (08/09).
//
// `reapDeadSessions` takes its candidates in one batch, then probes each container, a network
// round trip that can take seconds. A session paused meanwhile destroys its container, which is
// NORMAL for a pause: the sweep read `gone` and buried it. Session oo6ED67UqBb_: `waiting` and
// `failed` published in the same second.
//
// The cost is total: `resumeSession` requires `waiting`, so a pause overwritten this way can no
// longer be resumed, and the work sleeps on its branch with nobody to continue it.
describe("reapDeadSessions: the pause race", () => {
  beforeEach(() => resetBase());

  it("does not bury a session that paused DURING the probe", async () => {
    const id = "s-race",
      taskId = "t-race",
      runnerId = "r-docker-race";
    makeRunnerRow(runnerId, "docker");
    makeTask(taskId);
    makeSession(id, taskId, runnerId, "running");
    db.update(schema.sessions)
      .set({ runtimeHandle: "deadbeef0001" })
      .where(eq(schema.sessions.id, id))
      .run();
    // A SLOW fake `docker` answering "stopped": the container is gone, as after a pause. Its
    // slowness is the window that reproduces the race.
    const bin = join(dir, "bin-race");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "docker"), '#!/bin/sh\nsleep 1\necho "false"\n');
    chmodSync(join(bin, "docker"), 0o755);
    const realPath = process.env.PATH ?? "";
    process.env.PATH = `${bin}:${realPath}`;
    try {
      const sweeping = reapDeadSessions();
      // What `pauseForOperator` does while the probe is in flight.
      await new Promise((r) => setTimeout(r, 200));
      db.update(schema.sessions).set({ status: "waiting" }).where(eq(schema.sessions.id, id)).run();
      assert.equal(await sweeping, 0, "the session is no longer to sweep: its status changed");
    } finally {
      process.env.PATH = realPath;
    }

    const row = sessionRow(id);
    assert.equal(
      row?.status,
      "waiting",
      "the pause must survive the sweep, otherwise it can no longer be resumed",
    );
    assert.equal(row?.endedAt, null);
  });
});
