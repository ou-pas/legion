// Routing never goes to a sleeping machine (01/09, multi-machine work, slice 01).
//
// Held end to end through `runTask`, not on the private `pickRunnerRow`: what matters is that no
// session leaves for an unreachable runner.
//
//  1. An unreachable runner is never chosen. Sessions run on Macs, which sleep: without this
//     filter the session stayed `starting` forever and the task lied to the board for hours.
//  2. When all are unreachable, the error names the failure. "all runners at capacity" sent the
//     operator raising a ceiling that was not the problem, and it is a DIFFERENT error type from
//     the one `runTask` queues (launch-errors.ts, 05/09).
//
// And a third, in the spec: the runner's callback address wins. A container on the Mac mini
// calling back `localhost` calls the Mac mini, where nobody is listening.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-runner-health-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { UNREACHABLE_AFTER_MS } = await import("../../infra/probe.js");
const { runTask, sessionCallbackUrl } = await import("./manager.js");
const { wireFakeRunner } = await import("./test-wiring.js");
const { NoCapacityError, NoDiskError, NoReachableRunnerError } = await import("./launch-errors.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");
const { resetMetricsStoreForTests, setRunnerMetricsForTests } =
  await import("../../infra/metrics/store.js");
const { recordImageVerdict, resetImageVerdictStoreForTests } =
  await import("../../infra/images/verdict-store.js");
const { SESSION_IMAGE } = await import("../../infra/fleet-images.js");

const PROJECT = "p1";
const AGENT = "a1";

type Spec = import("./types.js").SessionSpec;
let provisioned: Spec | null = null;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned = spec;
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

function reset(): void {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "agent", rolePrompt: "r", createdAt: now })
    .run();
  provisioned = null;
}

/** `awake` = the probe just heard it; `asleep` = it has not heard it for two periods, i.e. a Mac
 *  that fell asleep. */
function runner(
  id: string,
  state: "awake" | "asleep",
  extra: { callbackUrl?: string; maxConcurrentSessions?: number } = {},
): void {
  db.insert(schema.runners)
    .values({
      id,
      name: id,
      kind: RUNNER_KIND.docker,
      lastSeenAt: new Date(Date.now() - (state === "awake" ? 0 : UNREACHABLE_AFTER_MS)),
      ...extra,
    })
    .run();
}

function makeTask(id: string): void {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.todo,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

/** A slot taken on this runner: the session counts, so its task is needed (foreign key). */
function occupy(runnerId: string): void {
  makeTask("t-busy");
  db.insert(schema.sessions)
    .values({
      id: "s-busy",
      taskId: "t-busy",
      agentId: AGENT,
      runnerId,
      model: "m",
      status: "running",
      callbackToken: "tok",
      startedAt: new Date(),
    })
    .run();
}

async function specOf(taskId: string): Promise<Spec> {
  await runTask(taskId);
  await new Promise((r) => setTimeout(r, 80)); // runLifecycle is fire-and-forget
  assert.ok(provisioned, "the fake runner received a spec");
  return provisioned;
}

const sessionRunner = (taskId: string) =>
  db.select().from(schema.sessions).where(eq(schema.sessions.taskId, taskId)).get()?.runnerId;

describe("pickRunnerRow: health before capacity", () => {
  beforeEach(() => reset());

  it("between an awake and a sleeping machine, the session goes to the awake one", async () => {
    runner("mac-mini", "asleep");
    runner("home-server", "awake");
    makeTask("t1");
    await specOf("t1");
    assert.equal(sessionRunner("t1"), "home-server");
  });

  it("the sleeping runner is set aside even when it is the MOST free: load does not redeem sleep", async () => {
    // Asleep and empty versus awake and half full: load balancing would pick the first.
    runner("mac-mini", "asleep", { maxConcurrentSessions: 8 });
    runner("home-server", "awake", { maxConcurrentSessions: 2 });
    occupy("home-server");
    makeTask("t1");
    await specOf("t1");
    assert.equal(sessionRunner("t1"), "home-server");
  });

  it('all asleep: the error says "no reachable runner" and NAMES the machines', async () => {
    runner("mac-mini", "asleep");
    runner("macbook", "asleep");
    makeTask("t1");
    await assert.rejects(
      () => runTask("t1"),
      (e: Error) =>
        /no reachable runner/.test(e.message) &&
        e.message.includes("mac-mini") &&
        e.message.includes("macbook"),
    );
    assert.equal(sessionRunner("t1"), undefined, "no session was created");
  });

  it("all asleep: the error is NOT a `NoCapacityError`, two failures, two gestures", async () => {
    runner("mac-mini", "asleep");
    makeTask("t1");
    await assert.rejects(
      () => runTask("t1"),
      (e: Error) => e instanceof NoReachableRunnerError && !(e instanceof NoCapacityError),
    );
  });

  it('awake but full: it is a `NoCapacityError`, and "at capacity" is what we read', async () => {
    runner("home-server", "awake", { maxConcurrentSessions: 1 });
    occupy("home-server");
    makeTask("t1");
    await assert.rejects(
      () => runTask("t1"),
      (e: Error) => e instanceof NoCapacityError && /at capacity/.test(e.message),
    );
  });

  it("a `process` runner has no daemon: never probed, always chosen", async () => {
    db.insert(schema.runners)
      .values({ id: "local", name: "local", kind: RUNNER_KIND.process })
      .run();
    makeTask("t1");
    await specOf("t1");
    assert.equal(sessionRunner("t1"), "local");
  });
});

describe("sessionCallbackUrl: the runner's address wins", () => {
  const saved = process.env.LEGION_CALLBACK_URL;
  after(() => {
    if (saved === undefined) delete process.env.LEGION_CALLBACK_URL;
    else process.env.LEGION_CALLBACK_URL = saved;
  });
  beforeEach(() => reset());

  it("the spec carries the runner's callback_url, not the global variable", async () => {
    process.env.LEGION_CALLBACK_URL = "http://global:8790";
    runner("mac-mini", "awake", { callbackUrl: "http://100.64.0.1:8790" });
    makeTask("t1");
    assert.equal((await specOf("t1")).callbackUrl, "http://100.64.0.1:8790");
  });

  it("without callback_url, the global variable takes over: nothing changes for the local runner", async () => {
    process.env.LEGION_CALLBACK_URL = "http://global:8790";
    runner("local", "awake");
    makeTask("t1");
    assert.equal((await specOf("t1")).callbackUrl, "http://global:8790");
  });

  it("with nothing at all, the local port: the pre-v51 behaviour", () => {
    delete process.env.LEGION_CALLBACK_URL;
    const before = process.env.PORT;
    process.env.PORT = "8791";
    try {
      assert.equal(sessionCallbackUrl({ callbackUrl: null }), "http://localhost:8791");
    } finally {
      if (before === undefined) delete process.env.PORT;
      else process.env.PORT = before;
    }
  });
});

// Disk routes, it does not block (04/09).
//
// The preflight disk guardrail came AFTER the runner choice: it refused the runner just
// designated, the queue put the task back, and the next round designated the SAME runner. Seen
// looping on `k2yUsVeGNK` while `portable-atelier` had fourteen gigabytes free and zero sessions.
//
// Held through `runTask`, not the private `pickRunnerRow`: what matters is that a session LEAVES
// on the machine that has room.
describe("disk routes the session instead of blocking it (04/09)", () => {
  /** A disk measurement set without probing: the DECISION is under test, not the probe. */
  function disk(runnerId: string, usedPct: number, totalMb: number): void {
    setRunnerMetricsForTests(runnerId, {
      vm: null,
      vmReason: "test",
      host: null,
      hostReason: "test",
      disk: { usedPct, totalMb, at: Date.now() },
      diskReason: null,
    });
  }

  beforeEach(() => {
    reset();
    resetMetricsStoreForTests();
  });

  it("picks the machine with room, never the one whose disk is full", async () => {
    runner("full", "awake");
    runner("roomy", "awake");
    disk("full", 95, 31_000); // ~1.5 GB free: below the threshold
    disk("roomy", 60, 58_000); // ~23 GB free
    makeTask("t1");
    const spec = await specOf("t1");
    // The spec does not carry the runner name: the session row does.
    const session = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, spec.sessionId))
      .get();
    assert.equal(session?.runnerId, "roomy");
  });

  it("a runner WITHOUT a measurement stays a candidate, otherwise a new fleet never starts", async () => {
    // The worst possible fix for this defect: a freshly declared runner has not been probed yet,
    // and excluding it would make it unusable until the first measurement.
    runner("never-probed", "awake");
    makeTask("t2");
    const spec = await specOf("t2");
    const session = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, spec.sessionId))
      .get();
    assert.equal(session?.runnerId, "never-probed");
  });

  it("all full: the error names the DISK, and is certainly not a `NoCapacityError`", async () => {
    // `NoCapacityError` is what `runTask` reads to queue the task. A queue waiting for room never
    // unblocks when what is missing is disk: the operator has cleanup to do, not a ceiling to
    // raise.
    runner("full-1", "awake");
    runner("full-2", "awake");
    disk("full-1", 96, 31_000);
    disk("full-2", 97, 31_000);
    makeTask("t3");
    await runTask("t3").then(
      () => assert.fail("the launch should have been refused"),
      (err: Error) => {
        assert.ok(err instanceof NoDiskError);
        assert.ok(!(err instanceof NoCapacityError));
        assert.match(err.message, /disk/i);
        assert.match(err.message, /full-1/, "the error names the machines and what they lack");
      },
    );
  });
});

// The image prefers, it never refuses (12/09).
//
// Split out of the batch that offered to rebuild a missing image (spec `J5tmew3aT8`): "fall back
// on a machine that has the image, as the disk has done since 04/09". The disk reasoning applies
// as is (a MISSING measurement does not exclude), but here the measurement is a REMEMBERED
// verdict (verdict-store.ts), never probed live by `pickRunnerRow`: one `docker image inspect` per
// candidate per round is exactly the cost this avoids.
describe("the image prefers a machine that has it, instead of refusing one that does not (12/09)", () => {
  beforeEach(() => {
    reset();
    resetImageVerdictStoreForTests();
  });

  it("a machine known to LACK the image yields to a machine that has it", async () => {
    runner("no-image", "awake");
    runner("has-image", "awake");
    recordImageVerdict("no-image", SESSION_IMAGE, { ok: false, why: "No such image" });
    recordImageVerdict("has-image", SESSION_IMAGE, { ok: true });
    makeTask("t1");
    await specOf("t1");
    assert.equal(sessionRunner("t1"), "has-image");
  });

  it("a NEVER PROBED machine stays a candidate: no verdict does not exclude", async () => {
    runner("never-probed", "awake");
    makeTask("t2");
    await specOf("t2");
    assert.equal(sessionRunner("t2"), "never-probed");
  });

  it("all known to lack it: pickRunnerRow does not refuse, it hands over to preflight", async () => {
    // Without this fallback, a whole queue would hit an error invented HERE rather than the refusal
    // preflight already names (image-preflight.ts), which drives the rebuild.
    runner("missing-1", "awake");
    runner("missing-2", "awake");
    recordImageVerdict("missing-1", SESSION_IMAGE, { ok: false, why: "no" });
    recordImageVerdict("missing-2", SESSION_IMAGE, { ok: false, why: "no" });
    makeTask("t3");
    await specOf("t3");
    assert.ok(["missing-1", "missing-2"].includes(sessionRunner("t3") ?? ""));
  });
});
