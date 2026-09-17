// `serializeTasks` computes `editable`/`briefEditable` correctly on a batch mixing several statuses,
// without a query per task (the list route already loads all sessions; see the module header). A
// bug here would be invisible over HTTP (the field is just `true`/`false`) but would make the screen
// lie about what it can edit.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-task-serialize-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { serializeTask, serializeTasks, serializeTaskSummaries } =
  await import("./task-serialize.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P1 = "p1";
const PDEMO = "pdemo";
const AGENT = "a1";
const RUNNER = "r1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects)
    .values([
      { id: P1, name: "P1", slug: "p1", createdAt: now },
      { id: PDEMO, name: "Demo", slug: "demo", createdAt: now, demo: true },
    ])
    .run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: P1, name: "a1", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
}

function makeTask(id: string, status: TaskStatus, projectId = P1) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId,
      name: id,
      status,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function makeLiveSession(taskId: string) {
  db.insert(schema.sessions)
    .values({
      id: `s-${taskId}`,
      taskId,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: new Date(),
    })
    .run();
}

describe("serializeTasks", () => {
  beforeEach(() => reset());

  it("correct editable per task on a batch mixing the five statuses, in one pass", () => {
    for (const status of [
      TASK_STATUS.later,
      TASK_STATUS.todo,
      TASK_STATUS.doing,
      TASK_STATUS.review,
      TASK_STATUS.done,
    ] as const)
      makeTask(`t-${status}`, status);
    const tasks = db.select().from(schema.tasks).all();
    const sessions = db.select().from(schema.sessions).all();
    const dtos = serializeTasks(tasks, sessions, new Set());
    const editable = new Map(dtos.map((t) => [t.id, t.editable]));
    assert.equal(editable.get("t-later"), true);
    assert.equal(editable.get("t-todo"), true);
    assert.equal(editable.get("t-doing"), false);
    assert.equal(editable.get("t-review"), false);
    assert.equal(editable.get("t-done"), false);
    // The brief stays editable on review/done (rule bd8ce68): not the same list.
    assert.equal(dtos.find((t) => t.id === "t-review")!.briefEditable, true);
    assert.equal(dtos.find((t) => t.id === "t-done")!.briefEditable, true);
  });

  it("a live session freezes both predicates for its own task only", () => {
    makeTask("t-a", TASK_STATUS.todo);
    makeTask("t-b", TASK_STATUS.todo);
    makeLiveSession("t-a");
    const tasks = db.select().from(schema.tasks).all();
    const sessions = db.select().from(schema.sessions).all();
    const dtos = serializeTasks(tasks, sessions, new Set());
    const byId = new Map(dtos.map((t) => [t.id, t]));
    assert.equal(byId.get("t-a")!.editable, false);
    assert.equal(byId.get("t-a")!.briefEditable, false);
    assert.equal(byId.get("t-b")!.editable, true);
    assert.equal(byId.get("t-b")!.briefEditable, true);
  });

  it("a demo project is never editable, even with a seeded live session", () => {
    makeTask("t-demo", TASK_STATUS.later, PDEMO);
    makeLiveSession("t-demo");
    const tasks = db.select().from(schema.tasks).all();
    const sessions = db.select().from(schema.sessions).all();
    const dtos = serializeTasks(tasks, sessions, new Set([PDEMO]));
    assert.equal(dtos[0]!.editable, false);
  });
});

describe("serializeTask", () => {
  beforeEach(() => reset());

  it("a freshly created task without a session is editable", () => {
    makeTask("t-fresh", TASK_STATUS.todo);
    const row = db.select().from(schema.tasks).all()[0]!;
    const dto = serializeTask(row);
    assert.equal(dto.editable, true);
    assert.equal(dto.briefEditable, true);
  });
});

// The 02/09 cut (measured: 108 full tasks to paint board cards): the list returns summaries, never
// the brief or criteria; see `serializeTaskSummaries`'s header.
describe("serializeTaskSummaries", () => {
  beforeEach(() => reset());

  it("drops description and criteria, keeps the rest, editable/blockedBy included", () => {
    const now = new Date();
    db.insert(schema.tasks)
      .values({
        id: "t-heavy",
        projectId: P1,
        name: "t-heavy",
        status: TASK_STATUS.todo,
        assigneeAgentId: AGENT,
        description: "an endless brief",
        criteria: '{"validatedBy":"x","items":[]}',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const tasks = db.select().from(schema.tasks).all();
    const [summary] = serializeTaskSummaries(tasks, [], new Set());
    assert.equal(summary!.id, "t-heavy");
    assert.equal("description" in summary!, false);
    assert.equal("criteria" in summary!, false);
    // The rest of the contract (computed by `serializeTasks`) must survive the cut.
    assert.equal(summary!.editable, true);
    assert.deepEqual(summary!.blockedBy, []);
  });

  it("a batch of several tasks keeps the same order and count as serializeTasks", () => {
    for (const status of [TASK_STATUS.later, TASK_STATUS.todo, TASK_STATUS.doing] as const)
      makeTask(`t-${status}`, status);
    const tasks = db.select().from(schema.tasks).all();
    const sessions = db.select().from(schema.sessions).all();
    const full = serializeTasks(tasks, sessions, new Set());
    const summaries = serializeTaskSummaries(tasks, sessions, new Set());
    assert.deepEqual(
      summaries.map((t) => t.id),
      full.map((t) => t.id),
    );
  });
});
