// The concurrent session cap (26/08). The bound (an integer from 1 to 16) is trivial; the COUNT is
// subtle: the cap compares with sessions holding a container, not those "still working". An inbox
// pause has no container, and counting it would stall the queue behind a sleeping session.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
// Static because it is a type: erased at compile time, it does not open the database early.
import type { Result } from "../../http/from-result.js";

const dir = mkdtempSync(join(tmpdir(), "legion-limits-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { eq } = await import("drizzle-orm");
const {
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  CPUS_MAX,
  CPUS_MIN,
  MEMORY_MAX_MB,
  MEMORY_MIN_MB,
  OCCUPYING_STATUSES,
  runnerLoad,
  runnerResources,
  setRunnerConcurrency,
  setRunnerResources,
} = await import("./limits.js");
const { SESSION_STATUS } = await import("../../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

// Refusals are returned since 06/09, so the STATUS gets checked too.
function value<T>(r: Result<T>): T {
  assert.ok(r.ok, r.ok ? "" : `unexpected refusal: ${r.error}`);
  return r.value;
}
function refusalOf<T>(r: Result<T>): { status: number; error: string } {
  assert.ok(!r.ok, "a refusal was expected, a success came");
  return { status: r.status, error: r.error };
}

const P = "p-lim",
  A = "a-lim",
  T = "t-lim",
  R = "r-lim",
  R2 = "r-lim-2";
const now = new Date();

function reset(): void {
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
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
  db.insert(schema.runners)
    .values({ id: R, name: "local", kind: RUNNER_KIND.docker, maxConcurrentSessions: 3 })
    .run();
  db.insert(schema.runners)
    .values({ id: R2, name: "home", kind: RUNNER_KIND.docker, maxConcurrentSessions: 2 })
    .run();
}

function session(id: string, status: string, runnerId = R): void {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: T,
      agentId: A,
      runnerId,
      status: status as "running",
      model: "sonnet",
      callbackToken: `tok-${id}`,
      startedAt: now,
    })
    .run();
}

const row = (id: string) =>
  db.select().from(schema.runners).where(eq(schema.runners.id, id)).get()!;
const capOf = (id: string) =>
  db.select().from(schema.runners).where(eq(schema.runners.id, id)).get()!.maxConcurrentSessions;

describe("changing the cap", () => {
  beforeEach(reset);

  it("writes it and returns the runner state", () => {
    const r = value(setRunnerConcurrency(R, 6));
    assert.equal(r.maxConcurrentSessions, 6);
    assert.equal(r.runnerName, "local");
    assert.equal(capOf(R), 6);
    assert.equal(capOf(R2), 2); // the other runner did not move
  });

  it("accepts a form value, which arrives as text", () => {
    assert.equal(value(setRunnerConcurrency(R, "6")).maxConcurrentSessions, 6);
    assert.equal(capOf(R), 6);
  });

  it("both exact bounds pass", () => {
    assert.equal(
      value(setRunnerConcurrency(R, CONCURRENCY_MIN)).maxConcurrentSessions,
      CONCURRENCY_MIN,
    );
    assert.equal(
      value(setRunnerConcurrency(R, CONCURRENCY_MAX)).maxConcurrentSessions,
      CONCURRENCY_MAX,
    );
  });
});

describe("what the bound refuses, saying so", () => {
  beforeEach(reset);

  it("zero: disabling a runner uses `enabled`, not a cap of 0", () => {
    const r = refusalOf(setRunnerConcurrency(R, 0));
    assert.equal(r.status, 400);
    assert.match(r.error, /integer between/);
    assert.equal(capOf(R), 3);
  });

  it("above the ceiling: the 60 typed for a 6", () => {
    assert.match(refusalOf(setRunnerConcurrency(R, 60)).error, /integer between/);
    assert.equal(capOf(R), 3);
  });

  it("a decimal, some text, nothing at all", () => {
    for (const bad of [2.5, "lots", "", null, undefined, {}])
      assert.match(refusalOf(setRunnerConcurrency(R, bad)).error, /integer between/);
    assert.equal(capOf(R), 3);
  });

  it("a runner that does not exist: 404", () => {
    assert.deepEqual(refusalOf(setRunnerConcurrency("does-not-exist", 4)), {
      status: 404,
      error: "runner not found",
    });
  });
});

describe("lowering below the load is allowed, and kills nothing", () => {
  beforeEach(reset);

  it("three sessions run, lowered to 1: they go on", () => {
    session("s1", "running");
    session("s2", "running");
    session("s3", "running");
    const r = value(setRunnerConcurrency(R, 1));
    assert.equal(r.maxConcurrentSessions, 1);
    assert.equal(r.running, 3);
    assert.equal(
      db
        .select()
        .from(schema.sessions)
        .all()
        .filter((s) => s.status === "running").length,
      3,
    );
  });
});

describe("what occupies a slot, and what does not", () => {
  beforeEach(reset);

  it("an inbox-paused session takes NO slot: its container is gone", () => {
    // The test that matters: `waiting` is still working for the task, but has no container.
    session("s1", "running");
    session("s2", SESSION_STATUS.waiting);
    assert.equal(runnerLoad().get(R), 1);
  });

  it("nor does an ended session", () => {
    session("s1", "destroyed");
    session("s2", "failed");
    assert.equal(runnerLoad().get(R), undefined);
  });

  it("starting, running and committing count, nothing else", () => {
    assert.deepEqual([...OCCUPYING_STATUSES], ["starting", "running", "committing"]);
    session("s1", "starting");
    session("s2", "running");
    session("s3", "committing");
    assert.equal(runnerLoad().get(R), 3);
  });

  it("load is counted PER runner", () => {
    session("s1", "running", R);
    session("s2", "running", R2);
    session("s3", "running", R2);
    const load = runnerLoad();
    assert.equal(load.get(R), 1);
    assert.equal(load.get(R2), 2);
  });
});

describe("a session's RAM and CPUs", () => {
  beforeEach(reset);

  it("the default is the pre-lot one: 1 GB, 1 CPU", () => {
    // The migration changes no existing session's behaviour; it makes the setting reachable.
    assert.deepEqual(runnerResources(row(R)), { memoryMb: 1024, cpus: 1 });
  });

  it("are set separately", () => {
    setRunnerResources(R, { memoryMb: 4096 });
    assert.deepEqual(runnerResources(row(R)), { memoryMb: 4096, cpus: 1 });
    setRunnerResources(R, { cpus: 2 });
    assert.deepEqual(runnerResources(row(R)), { memoryMb: 4096, cpus: 2 });
  });

  it("per RUNNER, because that is where machines differ", () => {
    // 16 GB on the dev machine, 32 on the home server: two runners, two settings.
    setRunnerResources(R, { memoryMb: 3072 });
    setRunnerResources(R2, { memoryMb: 6144 });
    assert.equal(row(R).memoryMb, 3072);
    assert.equal(row(R2).memoryMb, 6144);
  });

  it("CPUs accept a fraction, rounded to the hundredth", () => {
    value(setRunnerResources(R, { cpus: 1.5 }));
    assert.equal(row(R).cpus, 1.5);
    setRunnerResources(R, { cpus: 0.333333 });
    assert.equal(row(R).cpus, 0.33);
  });

  it("exact bounds pass", () => {
    setRunnerResources(R, { memoryMb: MEMORY_MIN_MB, cpus: CPUS_MIN });
    assert.deepEqual(runnerResources(row(R)), { memoryMb: MEMORY_MIN_MB, cpus: CPUS_MIN });
    setRunnerResources(R, { memoryMb: MEMORY_MAX_MB, cpus: CPUS_MAX });
    assert.deepEqual(runnerResources(row(R)), { memoryMb: MEMORY_MAX_MB, cpus: CPUS_MAX });
  });
});

describe("what resource bounds refuse", () => {
  beforeEach(reset);

  it("RAM below the runtime floor", () => {
    const r = refusalOf(setRunnerResources(R, { memoryMb: 128 }));
    assert.equal(r.status, 400);
    assert.match(r.error, /between 512 and/);
  });

  it("the 64 typed for a 4: in MB, that is 64 TB", () => {
    assert.match(
      refusalOf(setRunnerResources(R, { memoryMb: 64_000_000 })).error,
      /between 512 and/,
    );
  });

  it("zero CPUs, or the whole machine", () => {
    assert.match(refusalOf(setRunnerResources(R, { cpus: 0 })).error, /CPUs expected/);
    assert.match(refusalOf(setRunnerResources(R, { cpus: 64 })).error, /CPUs expected/);
  });

  it("text", () => {
    assert.match(refusalOf(setRunnerResources(R, { memoryMb: "lots" })).error, /between 512 and/);
    assert.match(refusalOf(setRunnerResources(R, { cpus: "two" })).error, /CPUs expected/);
  });

  it("a refusal writes nothing, not even partially", () => {
    // Valid `memoryMb`, invalid `cpus`: validation precedes ANY write. Half-applied is worse.
    assert.match(
      refusalOf(setRunnerResources(R, { memoryMb: 2048, cpus: 99 })).error,
      /CPUs expected/,
    );
    assert.deepEqual(runnerResources(row(R)), { memoryMb: 1024, cpus: 1 });
  });

  it("an empty request", () => {
    assert.deepEqual(refusalOf(setRunnerResources(R, {})), {
      status: 400,
      error: "nothing to change",
    });
  });

  it("an unknown runner", () => {
    assert.deepEqual(refusalOf(setRunnerResources("does-not-exist", { memoryMb: 2048 })), {
      status: 404,
      error: "runner not found",
    });
  });
});
