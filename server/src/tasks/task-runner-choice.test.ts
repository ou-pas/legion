// What this file protects, decision by decision (v66, settled with the operator):
//
//  1. the choice is set on the task, including a `doing` task a session left there by failing:
//     the field's very use, "change machine before rerunning". The brief's rule, not the settings',
//     which freeze at first start;
//  2. it stays set until changed or cleared; `null` clears it and hands back to the control plane,
//     which stays the default;
//  3. a live session refuses it (409): it runs on the machine it reserved, the choice will apply to
//     the next one;
//  4. a runner that does not exist is refused when set, by name, not discovered at launch.
//
// Real temporary SQLite, like `task-edit.test.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-task-runner-choice-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { chooseTaskRunner } = await import("./task-runner-choice.js");
const { applyTaskPatch } = await import("./task-patch.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P1 = "p1";
const A1 = "a1";
const RUNNER = "r1";
const OTHER = "r2";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "a1", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners)
    .values([
      { id: RUNNER, name: "mini", kind: RUNNER_KIND.process },
      { id: OTHER, name: "laptop", kind: RUNNER_KIND.process },
    ])
    .run();
}

function makeTask(status: TaskStatus): string {
  const now = new Date();
  const id = `t-${status}-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(schema.tasks)
    .values({
      id,
      projectId: P1,
      name: "task",
      status,
      assigneeAgentId: A1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function makeLiveSession(taskId: string) {
  db.insert(schema.sessions)
    .values({
      id: `s-${taskId}`,
      taskId,
      agentId: A1,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: new Date(),
    })
    .run();
}

const taskRow = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

describe("chooseTaskRunner", () => {
  beforeEach(() => reset());

  it("a task is born without a chosen machine: the control plane decides", () => {
    assert.equal(taskRow(makeTask(TASK_STATUS.todo))?.chosenRunnerId, null);
  });

  it("sets the machine on a doing task a failure left there: the case that created the field", () => {
    const id = makeTask(TASK_STATUS.doing);
    const r = chooseTaskRunner(id, OTHER);
    assert.equal(r.ok, true);
    assert.ok(r.ok);
    assert.equal(r.task.chosenRunnerId, OTHER);
  });

  it("the choice stays set, and `null` clears it", () => {
    const id = makeTask(TASK_STATUS.todo);
    chooseTaskRunner(id, RUNNER);
    assert.equal(taskRow(id)?.chosenRunnerId, RUNNER, "it does not clear itself");
    const cleared = chooseTaskRunner(id, null);
    assert.ok(cleared.ok);
    assert.equal(cleared.task.chosenRunnerId, null);
  });

  it("refuses (409) while a session runs, saying when the choice will apply", () => {
    const id = makeTask(TASK_STATUS.doing);
    makeLiveSession(id);
    const r = chooseTaskRunner(id, OTHER);
    assert.equal(r.ok, false);
    assert.ok(!r.ok);
    assert.equal(r.status, 409);
    assert.match(r.error, /session running in flight/);
    assert.match(r.error, /the next one/);
    assert.equal(taskRow(id)?.chosenRunnerId, null, "nothing was written");
  });

  it("refuses (400) a machine that does not exist, naming it", () => {
    const id = makeTask(TASK_STATUS.todo);
    const r = chooseTaskRunner(id, "invented-machine");
    assert.ok(!r.ok);
    assert.equal(r.status, 400);
    assert.match(r.error, /invented-machine/);
  });

  it("refuses (404) a task that does not exist", () => {
    const r = chooseTaskRunner("t-missing", RUNNER);
    assert.ok(!r.ok);
    assert.equal(r.status, 404);
  });
});

describe("PATCH /api/tasks/:id accepts the chosen runner", () => {
  beforeEach(() => reset());

  it("accepts it alone, on a task whose settings are already frozen", () => {
    const id = makeTask(TASK_STATUS.doing);
    const r = applyTaskPatch(id, { chosenRunnerId: OTHER });
    assert.ok(r.ok);
    assert.equal(r.task.chosenRunnerId, OTHER);
  });

  it("an empty body names the accepted fields, chosen runner included", () => {
    const r = applyTaskPatch(makeTask(TASK_STATUS.todo), {});
    assert.ok(!r.ok);
    assert.match(r.error, /chosenRunnerId/);
  });
});
