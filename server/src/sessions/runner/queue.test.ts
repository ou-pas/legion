// "Todo is the queue" (operator's decision, 23/08 evening):
//
//  1. A free task in todo is taken, without a `queued` flag and without having attempted a launch
//     at full capacity: filing in todo is the commitment gesture.
//  2. Later is the only parking: never taken.
//  3. Drivers keep the wheel: a chain step is taken only if explicitly queued (enqueueOnFull),
//     otherwise the pump would override autoRunNext=false; a task without an assignee (proposed by
//     an agent, draft) is never taken.
//  4. A free blocker's done frees ALL its dependants, and the queue takes them. Before, unblocking
//     only happened on the chain path: "B starts when A is done" could not be declared between two
//     free tasks.
//
// Same harness as wait-for-task.test.ts: real temporary SQLite, injected fake runner.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-queue-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { onTaskDone, settleDone } = await import("../../chains/templates.js");
const { addBlocker, blockersOf } = await import("../../tasks/blockers.js");
const { pumpQueue } = await import("./manager.js");
const { wireFakeRunner } = await import("./test-wiring.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

type Spec = import("./types.js").SessionSpec;
let provisioned: Spec[] = [];
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned.push(spec);
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.taskActivity).run();
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
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  provisioned = [];
}

function makeTask(id: string, over: Partial<typeof schema.tasks.$inferInsert> = {}) {
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
      ...over,
    })
    .run();
}

const taskRow = (id: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;
/** `pumpQueue` launches fire-and-forget: let the microtasks complete. */
const settle = () => new Promise((r) => setTimeout(r, 80));

describe("pumpQueue: todo is the queue", () => {
  beforeEach(() => reset());

  it("a free task in todo, never queued (queued=false), is taken", async () => {
    makeTask("t1");
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 1);
    assert.equal(provisioned[0]?.taskId, "t1");
    // The task was TAKEN (no longer in the queue) then SETTLED: the fake runner ends right away,
    // and since lot 82 a finished session settles its task even on success, otherwise a task whose
    // agent forgets `update_task` stays doing forever (fxHi2IpRXo, 26/08). `provisioned` is what
    // proves the launch.
    assert.equal(
      taskRow("t1").status,
      TASK_STATUS.review,
      "taken from the queue, then settled by the session end",
    );
  });

  it("later stays the only parking: never taken, even if queued by mistake", async () => {
    makeTask("t1", { status: TASK_STATUS.later, queued: true });
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 0);
  });

  it("without an assignee: never taken (it would fail in a loop on every tick)", async () => {
    makeTask("t1", { assigneeAgentId: null });
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 0);
  });

  it("a chain step NOT queued is not taken: autoRunNext keeps its meaning", async () => {
    makeTask("t1", { templateRunId: "run1", stepIndex: 0 });
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 0);
  });

  it("a QUEUED chain step (enqueueOnFull) is taken, as before", async () => {
    makeTask("t1", { templateRunId: "run1", stepIndex: 0, queued: true });
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 1);
  });

  it("a blocked task is skipped while a link holds it", async () => {
    makeTask("blocker", { status: TASK_STATUS.done });
    makeTask("t1");
    addBlocker("t1", "blocker");
    pumpQueue();
    await settle();
    assert.equal(provisioned.length, 0, "blocked = not taken");
  });
});

/** Done as its three callers do it: `settleDone` in the status transaction (here the blocker is
 *  already done), then `onTaskDone` with what it returned. */
const finish = (id: string) =>
  onTaskDone(
    id,
    db.transaction(() => settleDone(id)),
  );

describe("onTaskDone: a FREE blocker's done frees its dependants", () => {
  beforeEach(() => reset());

  it("unblocks the dependant and the queue takes it", async () => {
    makeTask("blocker", { status: TASK_STATUS.done });
    makeTask("t1");
    addBlocker("t1", "blocker");
    finish("blocker");
    await settle();
    assert.deepEqual(blockersOf("t1"), [], "the link is consumed");
    assert.equal(provisioned.length, 1, "the queue took it");
    assert.equal(provisioned[0]?.taskId, "t1");
  });

  it("unblocks ALL dependants of the same blocker", async () => {
    makeTask("blocker", { status: TASK_STATUS.done });
    makeTask("t1");
    makeTask("t2");
    addBlocker("t1", "blocker");
    addBlocker("t2", "blocker");
    finish("blocker");
    await settle();
    assert.deepEqual(blockersOf("t1"), []);
    assert.deepEqual(blockersOf("t2"), []);
    assert.equal(provisioned.length, 2, "both start (capacity available)");
  });

  it("a dependant in later is unlinked but stays parked: later never moves on its own", async () => {
    makeTask("blocker", { status: TASK_STATUS.done });
    makeTask("t1", { status: TASK_STATUS.later });
    addBlocker("t1", "blocker");
    finish("blocker");
    await settle();
    // The link is consumed whatever the status (behaviour 8: an event, not a recomputed state).
    // But the LAUNCH only looks at `todo`: a parked task is not launched behind the operator's back.
    assert.deepEqual(blockersOf("t1"), [], "unlinked");
    assert.equal(taskRow("t1").status, TASK_STATUS.later, "still parked");
    assert.equal(provisioned.length, 0, "not launched");
  });
});
