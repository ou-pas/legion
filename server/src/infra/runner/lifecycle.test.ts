// Cleaning up a disabled/deleted runner (04/09):
//  1. unknown runner → 404;
//  2. a LIVE session on it (running/committing, AND waiting/blocked) blocks both actions, 409;
//  3. otherwise disabling a docker runner TRIGGERS `cleanupOrphans` in the same action, closing the
//     `legion-browser-s6PeSEW3Dl` hole;
//  4. a `process` runner reports cleanup as skipped, never attempted;
//  5. re-enabling cleans nothing;
//  6. deleting a runner that ever carried a session (FK) → 409, row kept; a never-used runner is
//     deleted with its cleanup.
// LEGION_INFRA_FAKE=1: the `cleanupOrphans` fixture returns a deterministic trace, enough to prove
// the hook is wired, not what docker would really remove (infra.test.ts covers that).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "../../sessions/session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-runner-lifecycle-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_INFRA_FAKE = "1";
after(() => {
  delete process.env.LEGION_INFRA_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const { db, schema } = await import("../../shared/db.js");
const { deleteRunner, runnerLiveSessions, setRunnerEnabled } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const DOCKER_RUNNER = "r-docker";
const PROCESS_RUNNER = "r-process";
const FRESH_RUNNER = "r-fresh";
const P1 = "p1";
const A1 = "a1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects)
    .values({ id: P1, name: "P1", slug: "p1", createdAt: now, demo: false })
    .run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "a1", rolePrompt: "role", createdAt: now })
    .run();
  db.insert(schema.runners)
    .values([
      { id: DOCKER_RUNNER, name: "docker-runner", kind: RUNNER_KIND.docker },
      { id: PROCESS_RUNNER, name: "process-runner", kind: RUNNER_KIND.process },
      { id: FRESH_RUNNER, name: "fresh-runner", kind: RUNNER_KIND.docker },
    ])
    .run();
}

function makeSession(runnerId: string, status: SessionStatus) {
  const now = new Date();
  const taskId = `t-${runnerId}-${status}-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(schema.tasks)
    .values({
      id: taskId,
      projectId: P1,
      name: "t",
      assigneeAgentId: A1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: `s-${taskId}`,
      taskId,
      agentId: A1,
      runnerId,
      model: "sonnet",
      status,
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

const runnerRow = (id: string) =>
  db.select().from(schema.runners).where(eq(schema.runners.id, id)).get();

describe("setRunnerEnabled", () => {
  beforeEach(() => reset());

  it("unknown runner → 404", async () => {
    const r = await setRunnerEnabled("nope", false);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 404);
  });

  it("live session (running) → 409, the runner stays enabled", async () => {
    makeSession(DOCKER_RUNNER, "running");
    const r = await setRunnerEnabled(DOCKER_RUNNER, false);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 409 && r.live?.length === 1);
    assert.equal(runnerRow(DOCKER_RUNNER)!.enabled, true);
  });

  it("a paused session (waiting) blocks too: it will resume on this runner", async () => {
    makeSession(DOCKER_RUNNER, "waiting");
    const r = await setRunnerEnabled(DOCKER_RUNNER, false);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 409);
  });

  it("disabling a docker runner without live sessions cleans its leftovers in the same action", async () => {
    const r = await setRunnerEnabled(DOCKER_RUNNER, false);
    assert.ok(r.ok);
    assert.equal(r.ok && r.runner.enabled, false);
    assert.equal(runnerRow(DOCKER_RUNNER)!.enabled, false);
    // A non-empty fixture trace proves the hook was called, not what docker would remove.
    assert.ok(r.ok && r.cleanup.removed.length > 0);
    assert.equal(r.ok && r.cleanup.skipped, null);
  });

  it("disabling a process runner attempts no docker cleanup", async () => {
    const r = await setRunnerEnabled(PROCESS_RUNNER, false);
    assert.ok(r.ok);
    assert.ok(r.ok && r.cleanup.skipped !== null);
    assert.equal(r.ok && r.cleanup.removed.length, 0);
  });

  it("re-enabling cleans nothing", async () => {
    await setRunnerEnabled(DOCKER_RUNNER, false);
    const r = await setRunnerEnabled(DOCKER_RUNNER, true);
    assert.ok(r.ok);
    assert.equal(r.ok && r.runner.enabled, true);
    assert.equal(runnerRow(DOCKER_RUNNER)!.enabled, true);
    assert.equal(r.ok && r.cleanup.removed.length, 0);
  });
});

describe("deleteRunner", () => {
  beforeEach(() => reset());

  it("unknown runner → 404", async () => {
    const r = await deleteRunner("nope");
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 404);
  });

  it("live session → 409, the row stays", async () => {
    makeSession(FRESH_RUNNER, "committing");
    const r = await deleteRunner(FRESH_RUNNER);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 409);
    assert.ok(runnerRow(FRESH_RUNNER));
  });

  it("a runner that ever carried a session (even ended) → 409, never deleted", async () => {
    makeSession(DOCKER_RUNNER, "destroyed");
    const r = await deleteRunner(DOCKER_RUNNER);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 409 && /only disabled/.test(r.error));
    assert.ok(runnerRow(DOCKER_RUNNER));
  });

  it("never-used runner → deleted, with its cleanup", async () => {
    const r = await deleteRunner(FRESH_RUNNER);
    assert.ok(r.ok);
    assert.equal(runnerRow(FRESH_RUNNER), undefined);
    assert.ok(r.ok && r.cleanup.removed.length > 0);
  });
});

describe("runnerLiveSessions", () => {
  beforeEach(() => reset());

  it("ignores terminal statuses, counts active ones", () => {
    makeSession(DOCKER_RUNNER, "destroyed");
    makeSession(DOCKER_RUNNER, "failed");
    assert.equal(runnerLiveSessions(DOCKER_RUNNER).length, 0);
    makeSession(DOCKER_RUNNER, "blocked");
    assert.equal(runnerLiveSessions(DOCKER_RUNNER).length, 1);
  });
});
