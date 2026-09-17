// The runner chosen by the operator, seen from the queue (v66, 09/09). One decision per test:
//  · no chosen runner stays the DEFAULT, the control plane decides;
//  · a chosen runner is HARD: the session starts there even if another machine is less loaded;
//  · an unreachable chosen runner is a NAMED refusal, neither a queue nor a fallback;
//  · that refusal concerns ONLY its task: the queue goes on for the others.
//
// Same harness as `queue-race.test.ts`: nothing is spawned, docker is never called.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-chosen-runner-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { pumpQueue, runTask } = await import("./manager.js");
const { wireFakeRunner, wireFakeDaemonProbe } = await import("./test-wiring.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
/** `free` is inserted FIRST: at equal load the fleet would designate it, so pinning the other is
 *  the only way to prove the choice won. */
const FREE = "free";
const PINNED = "pinned";

type Spec = import("./types.js").SessionSpec;

wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => ({ id: spec.sessionId, runtime: "fake" }),
  wait: () => new Promise<never>(() => {}),
  destroy: async () => {},
}));
wireFakeDaemonProbe(async () => ({ ok: true as const }));
after(() => {
  wireFakeRunner(null);
  wireFakeDaemonProbe(null);
});

/** Two declared machines. `asleep` = never heard by the periodic probe, so unreachable for routing
 *  (`runnerReachable` reads `last_seen_at`). */
function reset(opts: { asleep?: string; disabled?: string } = {}): void {
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
  for (const id of [FREE, PINNED]) {
    db.insert(schema.runners)
      .values({
        id,
        name: id,
        kind: RUNNER_KIND.docker,
        maxConcurrentSessions: 2,
        enabled: opts.disabled !== id,
        lastSeenAt: opts.asleep === id ? null : now,
      })
      .run();
  }
}

function makeTask(id: string, chosenRunnerId: string | null = null): void {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.todo,
      assigneeAgentId: AGENT,
      chosenRunnerId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

const sessions = () => db.select().from(schema.sessions).all();
const task = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
const settle = () => new Promise((r) => setTimeout(r, 80));

describe("a task's chosen runner", () => {
  beforeEach(() => reset());

  it("no chosen runner: the fleet decides, as before", async () => {
    makeTask("t1");
    await runTask("t1");
    assert.equal(sessions()[0]?.runnerId, FREE, "at equal load, the registry's first machine");
  });

  it("a chosen runner wins, even when the other machine is just as free", async () => {
    makeTask("t1", PINNED);
    await runTask("t1");
    assert.equal(sessions()[0]?.runnerId, PINNED);
  });

  it("an ASLEEP chosen runner refuses naming it, and does NOT queue the task", async () => {
    reset({ asleep: PINNED });
    makeTask("t1", PINNED);

    await assert.rejects(
      () => runTask("t1", { enqueueOnFull: true }),
      /the chosen runner “pinned” is not answering/,
    );
    assert.equal(
      task("t1")?.queued,
      false,
      "waiting does not switch a machine on: the refusal surfaces",
    );
    assert.equal(sessions().length, 0, "no slot reserved");
  });

  it("a DISABLED chosen runner refuses naming it, without falling back to the other", async () => {
    reset({ disabled: PINNED });
    makeTask("t1", PINNED);

    await assert.rejects(() => runTask("t1"), /the chosen runner “pinned” is disabled/);
    assert.equal(sessions().length, 0, "a silent fallback would cancel the gesture");
  });

  it("a chosen runner that no longer exists refuses saying so", async () => {
    makeTask("t1", "removed-machine");
    await assert.rejects(() => runTask("t1"), /no longer exists in the fleet/);
  });

  it("the queue skips the task whose machine sleeps, and launches the others", async () => {
    reset({ asleep: PINNED });
    makeTask("t1", PINNED); // created first: without the guard, its refusal stopped the loop
    makeTask("t2");

    pumpQueue();
    await settle();

    assert.equal(task("t1")?.status, TASK_STATUS.todo, "it waits for its operator, not for a slot");
    assert.equal(task("t2")?.status, TASK_STATUS.doing);
    assert.equal(sessions().length, 1);
    assert.equal(sessions()[0]?.taskId, "t2");
    assert.equal(sessions()[0]?.runnerId, FREE);
  });
});
