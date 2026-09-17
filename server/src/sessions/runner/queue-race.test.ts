// The queue does not over-launch (05/09).
//
// `pumpQueue` fires `void runTask(t.id)` for each candidate and recounts load between calls from
// the `sessions` table (`pickRunnerRow`). `runTask`'s Docker probe (25/08) had slipped in BEFORE
// the row insert: each call yielded on that `await`, the loop recounted zero load, and N tasks
// started on a one-slot runner.
//
// The proof holds the probe OPEN while counting: if the reservation precedes the wait, one row
// exists when `pumpQueue` returns; otherwise there are three. Nothing is spawned.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-queue-race-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { OCCUPYING_STATUSES } = await import("../../infra/runner/limits.js");
const { pumpQueue, runTask } = await import("./manager.js");
const { wireFakeRunner, wireFakeDaemonProbe } = await import("./test-wiring.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");
const { resetRunnerUnavailabilityForTests } = await import("../../infra/runner/unavailability.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "solo";

type Spec = import("./types.js").SessionSpec;
type Verdict = { ok: true } | { ok: false; why: string };

/** A fake runner whose sessions NEVER END: the slot stays taken, and the first one ending does
 *  not pump the queue. That is the state to read afterwards. */
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => ({ id: spec.sessionId, runtime: "fake" }),
  wait: () => new Promise<never>(() => {}),
  destroy: async () => {},
}));
after(() => {
  wireFakeRunner(null);
  wireFakeDaemonProbe(null);
});

/** A probe the test HOLDS: it only answers once released, and the same answer serves every call,
 *  immediately once released. */
function heldProbe() {
  let release: (v: Verdict) => void = () => {};
  const verdict = new Promise<Verdict>((r) => {
    release = r;
  });
  let calls = 0;
  wireFakeDaemonProbe(() => {
    calls++;
    return verdict;
  });
  return { release, calls: () => calls };
}

function reset(): void {
  // Without this reset, a refusal marked by a previous test (`markRunnerUnavailable`, called by
  // `assertRunnerReady` on a refusing probe) survives in `unavailability.ts`'s in-memory Map, keyed
  // by `runnerId`, and this file ALWAYS reuses the same id (`RUNNER = "solo"`). `pumpQueue` then
  // skipped the next test's task believing its machine still down, never calling `launch`: no
  // session was created.
  resetRunnerUnavailabilityForTests();
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
  // A REACHABLE docker runner (the periodic probe just heard it), with ONE slot.
  db.insert(schema.runners)
    .values({
      id: RUNNER,
      name: RUNNER,
      kind: RUNNER_KIND.docker,
      maxConcurrentSessions: 1,
      lastSeenAt: now,
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

const sessions = () => db.select().from(schema.sessions).all();
const occupying = () =>
  db
    .select()
    .from(schema.sessions)
    .where(inArray(schema.sessions.status, [...OCCUPYING_STATUSES]))
    .all();
const task = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
/** `runTask` is fire-and-forget behind `pumpQueue`: let the event loop run. */
const settle = () => new Promise((r) => setTimeout(r, 80));

describe("the queue reserves the slot BEFORE awaiting the probe", () => {
  beforeEach(() => reset());

  it("three candidates, one slot, a probe that has not answered yet: ONE session, not three", async () => {
    makeTask("t1");
    makeTask("t2");
    makeTask("t3");
    const probe = heldProbe();

    pumpQueue();

    // The loop returned and the probe has not answered: HERE is where over-launching showed. One
    // row, and it holds the slot.
    assert.equal(sessions().length, 1, "the slot must be reserved before the first await");
    assert.equal(occupying().length, 1);
    assert.equal(probe.calls(), 1, "the other two did not even probe: the slot was taken");

    probe.release({ ok: true });
    await settle();
    // The first started; the other two WAIT (in todo, which IS the queue), and no slot was invented
    // while the probe answered.
    assert.equal(sessions().length, 1);
    assert.equal(sessions()[0]?.status, "running");
    assert.equal(sessions()[0]?.runnerId, RUNNER);
    assert.equal(task("t1")?.status, TASK_STATUS.doing);
    assert.equal(task("t2")?.status, TASK_STATUS.todo);
    assert.equal(task("t3")?.status, TASK_STATUS.todo);
  });

  it("a refusing probe RELEASES the slot: the session is `failed` with the cause, the task did not move", async () => {
    makeTask("t1");
    wireFakeDaemonProbe(async () => ({ ok: false, why: "silent daemon" }));

    await assert.rejects(
      () => runTask("t1"),
      /Docker is not answering on runner “solo”: silent daemon/,
    );

    const [s] = sessions();
    assert.equal(s?.status, "failed");
    assert.match(s?.endReason ?? "", /silent daemon/);
    assert.equal(occupying().length, 0, "the slot is released");
    assert.equal(
      task("t1")?.status,
      TASK_STATUS.todo,
      "`markTaskStarted` comes after the check: the task stays where it was",
    );
  });

  it("through the queue, the same refusal requeues the task instead of losing it", async () => {
    makeTask("t1");
    wireFakeDaemonProbe(async () => ({ ok: false, why: "silent daemon" }));

    pumpQueue();
    await settle();

    assert.equal(sessions()[0]?.status, "failed");
    assert.equal(occupying().length, 0);
    assert.equal(task("t1")?.status, TASK_STATUS.todo);
    assert.equal(task("t1")?.queued, true, "pumpQueue's `.catch` requeues");
  });
});
