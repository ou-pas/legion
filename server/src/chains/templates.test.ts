// Release when a task finishes, MIGRATE phase of "dependencies become a graph" ("decoupe" spec,
// behaviour 8, slice 02):
//
//  1. Conjunction. A task blocked by two stays blocked when the first finishes and is released
//     when the second does, once: finishing the second again relaunches nothing.
//  2. A blocker sent back to doing does not recreate its link: release follows links, not statuses.
//  3. A task moved to done has its own links consumed with it, whatever its blockers' state.
//  4. Transaction. `settleDone` is decided inside the transaction that finishes the blocker
//     (B8/concurrency): rolled back, the links stay.
//  5. Today's path. A released chain step starts through `autoRunNext`, a free task through the
//     queue: `onTaskDone` receives what `settleDone` returned.
//
// Real temporary SQLite, fake runner injected: `provisioned` proves a launch, its absence proves
// there was none.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-templates-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { contextNotes, instantiateTemplate, onTaskDone, settleDone } =
  await import("./templates.js");
const { addBlocker, blockersOf } = await import("../tasks/blockers.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

/** A chain, unwrapped. `instantiateTemplate` returns its refusal since 06/09 instead of throwing:
 *  an unexpected refusal must fail the test by naming it. */
const chainOf = (templateId: string, request: string) => {
  const r = instantiateTemplate(templateId, request);
  assert.ok(r.ok, r.ok ? "" : `unexpected refusal: ${r.error}`);
  return r.value;
};

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

type Spec = import("../sessions/runner/types.js").SessionSpec;
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
  db.delete(schema.tasks).run(); // task_blockers follows by CASCADE
  db.delete(schema.taskTemplates).run();
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

/** A todo task with no agent by default: the queue only takes what carries an agent, so a blocker
 *  created this way is never launched behind the test's back. The dependent gets one. */
function makeTask(id: string, over: Partial<typeof schema.tasks.$inferInsert> = {}) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .run();
}

const taskRow = (id: string) =>
  db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;
/** `pumpQueue`/`runTask` launch fire-and-forget: let the microtasks complete. */
const settle = () => new Promise((r) => setTimeout(r, 80));

/** What the three paths that finish a task do (operator PATCH, Kanban drop, the agent's
 *  `/internal`): status update and `settleDone` in one transaction, then `onTaskDone` outside it.
 *  Returns what the done released. */
function finish(id: string): string[] {
  const released = db.transaction(() => {
    db.update(schema.tasks)
      .set({ status: TASK_STATUS.done, updatedAt: new Date() })
      .where(eq(schema.tasks.id, id))
      .run();
    return settleDone(id);
  });
  onTaskDone(id, released);
  return released;
}

describe("onTaskDone: release is a conjunction", () => {
  beforeEach(() => reset());

  it("two blockers: the first finishing releases nothing, the second releases, finishing the second again relaunches nothing", async () => {
    makeTask("A");
    makeTask("B");
    makeTask("t", { assigneeAgentId: AGENT });
    addBlocker("t", "A");
    addBlocker("t", "B");

    assert.deepEqual(finish("A"), [], "A was not the last: nothing is released");
    await settle();
    assert.deepEqual(blockersOf("t"), ["B"], "A's link is consumed, B's still holds");
    assert.equal(provisioned.length, 0, "t stays blocked, the queue does not take it");

    assert.deepEqual(finish("B"), ["t"], "B was the last: t is released");
    await settle();
    assert.deepEqual(blockersOf("t"), []);
    assert.equal(provisioned.length, 1, "the queue took it, once");
    assert.equal(provisioned[0]?.taskId, "t");

    assert.deepEqual(finish("B"), [], "a consumed event does not replay");
    await settle();
    assert.equal(provisioned.length, 1, "nothing is relaunched");
  });

  it("a done blocker moved back to doing does not recreate its link: the last one still releases", async () => {
    makeTask("A");
    makeTask("B");
    makeTask("t", { assigneeAgentId: AGENT });
    addBlocker("t", "A");
    addBlocker("t", "B");

    finish("A");
    db.update(schema.tasks)
      .set({ status: TASK_STATUS.doing })
      .where(eq(schema.tasks.id, "A"))
      .run(); // sent back to doing
    await settle();
    assert.deepEqual(blockersOf("t"), ["B"], "A's link is not reborn");
    assert.equal(provisioned.length, 0);

    assert.deepEqual(finish("B"), ["t"], "A is doing but its link is consumed: B was the last");
    await settle();
    assert.equal(provisioned.length, 1);
    assert.equal(provisioned[0]?.taskId, "t");
  });

  it("a task moved to done has its links consumed with it, whatever its blockers' state", async () => {
    makeTask("A");
    makeTask("t", { assigneeAgentId: AGENT });
    addBlocker("t", "A");

    assert.deepEqual(finish("t"), [], "t blocked nobody");
    await settle();
    assert.deepEqual(blockersOf("t"), [], "what held it no longer counts");
    assert.equal(taskRow("A").status, TASK_STATUS.todo, "A did not move");
    assert.equal(provisioned.length, 0);
  });

  it("consumption belongs to the transaction finishing the blocker: rolled back, nothing is consumed", () => {
    makeTask("A");
    makeTask("t");
    addBlocker("t", "A");
    assert.throws(
      () =>
        db.transaction(() => {
          db.update(schema.tasks)
            .set({ status: TASK_STATUS.done })
            .where(eq(schema.tasks.id, "A"))
            .run();
          assert.deepEqual(settleDone("A"), ["t"], "seen from inside, t is released");
          throw new Error("the transaction fails after consumption");
        }),
      /fails after/,
    );
    assert.equal(taskRow("A").status, TASK_STATUS.todo, "the status is back");
    assert.deepEqual(blockersOf("t"), ["A"], "and the link with it");
  });

  it("a released chain step starts through autoRunNext, as before", async () => {
    const step = (name: string) => ({
      name,
      agentName: "agent",
      approvalGate: false,
      expectedArtifacts: [],
      prompt: "p",
    });
    db.insert(schema.taskTemplates)
      .values({
        id: "tpl",
        projectId: PROJECT,
        name: "chain",
        steps: JSON.stringify([step("1"), step("2")]),
        autoRunNext: true,
        createdAt: new Date(),
      })
      .run();
    const {
      taskIds: [s1, s2],
    } = chainOf("tpl", "request");
    assert.deepEqual(finish(s1!), [s2]);
    await settle();
    assert.deepEqual(blockersOf(s2!), []);
    assert.equal(provisioned.length, 1, "the next step is launched by the chain, not by the queue");
    assert.equal(provisioned[0]?.taskId, s2);
  });
});

// A chain's links are born in its steps' transaction (05/09). `addBlocker` receives
// `instantiateTemplate`'s `tx` instead of writing through `db`: same result on better-sqlite3 (one
// handle), but it now holds by construction, and this test pins it.
describe("instantiateTemplate: links and steps, all or nothing", () => {
  beforeEach(() => reset());
  const step = (name: string) => ({
    name,
    agentName: "agent",
    approvalGate: false,
    expectedArtifacts: [],
    prompt: "p",
  });
  const threeSteps = () =>
    db
      .insert(schema.taskTemplates)
      .values({
        id: "tpl",
        projectId: PROJECT,
        name: "chain",
        steps: JSON.stringify([step("1"), step("2"), step("3")]),
        autoRunNext: false,
        createdAt: new Date(),
      })
      .run();

  it("each step is held by the previous one, and only by it", () => {
    threeSteps();
    const {
      taskIds: [s1, s2, s3],
    } = chainOf("tpl", "request");
    assert.deepEqual(blockersOf(s1!), []);
    assert.deepEqual(blockersOf(s2!), [s1]);
    assert.deepEqual(blockersOf(s3!), [s2]);
  });

  it("a step that cannot be inserted takes the already inserted steps and their links with it", () => {
    threeSteps();
    // A SQLite trigger refuses the third step: the failure lands after two steps and a link were
    // written, exactly where a write outside the transaction would leave a trace.
    db.run(
      sql`CREATE TRIGGER tasks_refuse_step BEFORE INSERT ON tasks WHEN NEW.step_index = 2 BEGIN SELECT RAISE(ABORT, 'test refusal'); END`,
    );
    try {
      assert.throws(() => instantiateTemplate("tpl", "request"), /test refusal/);
    } finally {
      db.run(sql`DROP TRIGGER tasks_refuse_step`);
    }
    assert.equal(db.select().from(schema.tasks).all().length, 0, "no step remains");
    assert.equal(db.select().from(schema.taskBlockers).all().length, 0, "no link remains");
  });
});

// What the model reads to enrich the context (30/08). The fixed defect was an order, not wrong
// logic: see `contextNotes` in templates.ts. Checked for real on 30/08: called by hand with an
// actual session's 815-character note, enrichment fixed the project context first time (1169 →
// 1699 characters). The mechanism was not broken, it was fed nothing.
describe("contextNotes: this done's note is included", () => {
  it("the note passed in joins the history", () => {
    assert.equal(contextNotes(["first"], "this one"), "first | this one");
  });

  it("a task with no history does not send emptiness when it has a note", () => {
    // The defect's exact case: the task's only note, not yet in the database.
    assert.equal(contextNotes([], "the only note"), "the only note");
  });

  it("no note at all returns an empty string, not undefined", () => {
    assert.equal(contextNotes([]), "");
    assert.equal(contextNotes([], "   "), "");
  });

  it("history alone still works: calls without a note are unchanged", () => {
    assert.equal(contextNotes(["a", "b"]), "a | b");
  });
});
