// What this file protects:
//
//  1. the composer's five settings (title, agent, gate, complexity, priority) can be amended while
//     the task has not started, and otherwise refuse by name (404, agent outside the project, live
//     session, frozen status, demo project): a mute refusal cannot be repaired;
//  2. the editability guard is carried twice (named read + the `UPDATE`'s `WHERE`): even if the
//     task started between read and write, the edit must never succeed silently; `changes === 0`
//     falls back to a refusal, not a success.
//
// Real temporary SQLite, like lifecycle.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-task-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { applyTaskEdit } = await import("./task-edit.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { PRIORITY } = await import("./task-scales.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P1 = "p1";
const P2 = "p2";
const A1 = "a1"; // agent of project P1
const A2 = "a2"; // agent of project P2, for the R2 refusal
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
      { id: P2, name: "P2", slug: "p2", createdAt: now, demo: false },
    ])
    .run();
  db.insert(schema.agents)
    .values([
      { id: A1, projectId: P1, name: "a1", rolePrompt: "r", createdAt: now },
      { id: A2, projectId: P2, name: "a2", rolePrompt: "r", createdAt: now },
    ])
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
}

function makeTask(status: TaskStatus, projectId = P1, agentId = A1): string {
  const now = new Date();
  const id = `t-${status}-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(schema.tasks)
    .values({
      id,
      projectId,
      name: "original title",
      status,
      assigneeAgentId: agentId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function makeLiveSession(taskId: string, agentId = A1) {
  db.insert(schema.sessions)
    .values({
      id: `s-${taskId}`,
      taskId,
      agentId,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: new Date(),
    })
    .run();
}

const taskRow = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

describe("applyTaskEdit", () => {
  beforeEach(() => reset());

  it("renames a later task; the re-read row carries the new name and a newer updatedAt", () => {
    const id = makeTask(TASK_STATUS.later);
    const before = taskRow(id)!;
    const r = applyTaskEdit(id, { name: "new title" });
    assert.equal(r.ok, true);
    assert.ok(r.ok);
    assert.equal(r.task.name, "new title");
    assert.ok(r.task.updatedAt.getTime() >= before.updatedAt.getTime());
  });

  it("trims the name", () => {
    const id = makeTask(TASK_STATUS.later);
    const r = applyTaskEdit(id, { name: "  x  " });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.name, "x");
  });

  it("empty or blank name → 400", () => {
    const id = makeTask(TASK_STATUS.later);
    for (const bad of ["", "   "]) {
      const r = applyTaskEdit(id, { name: bad });
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.status, 400);
    }
  });

  it("name > 200 characters → 400, the message gives the received length", () => {
    const id = makeTask(TASK_STATUS.later);
    const long = "x".repeat(201);
    const r = applyTaskEdit(id, { name: long });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && r.error.includes("201"));
  });

  it("changes the agent, within the same project → ok", () => {
    const otherAgent = "a1b";
    db.insert(schema.agents)
      .values({
        id: otherAgent,
        projectId: P1,
        name: "a1b",
        rolePrompt: "r",
        createdAt: new Date(),
      })
      .run();
    const id = makeTask(TASK_STATUS.later);
    const r = applyTaskEdit(id, { agentId: otherAgent });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.assigneeAgentId, otherAgent);
  });

  it("agent from another project → 400, the message names both projects", () => {
    const id = makeTask(TASK_STATUS.later, P1, A1);
    const r = applyTaskEdit(id, { agentId: A2 });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && r.error.includes(P1) && r.error.includes(P2));
  });

  it("missing agent → clean 400, not an FK constraint exception", () => {
    const id = makeTask(TASK_STATUS.later);
    assert.doesNotThrow(() => {
      const r = applyTaskEdit(id, { agentId: "does-not-exist" });
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.status, 400);
    });
  });

  it("complexity outside the enum → 400", () => {
    const id = makeTask(TASK_STATUS.later);
    const r = applyTaskEdit(id, { complexity: "extreme" as never });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("priority outside the enum → 400", () => {
    const id = makeTask(TASK_STATUS.later);
    const r = applyTaskEdit(id, { priority: "urgent" as never });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("non-boolean approvalGate → 400", () => {
    const id = makeTask(TASK_STATUS.later);
    const r = applyTaskEdit(id, { approvalGate: "yes" as never });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("body with no editable field → 400", () => {
    const id = makeTask(TASK_STATUS.later);
    const r = applyTaskEdit(id, {});
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 400);
  });

  it("unknown task → 404", () => {
    const r = applyTaskEdit("does-not-exist", { name: "x" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 404);
  });

  it("doing task → 409, the message names the status", () => {
    const id = makeTask(TASK_STATUS.doing);
    const r = applyTaskEdit(id, { name: "x" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 409 && r.error.includes(TASK_STATUS.doing));
  });

  it("todo task with a live session → 409, the message names the session", () => {
    const id = makeTask(TASK_STATUS.todo);
    makeLiveSession(id);
    const r = applyTaskEdit(id, { name: "x" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 409 && r.error.includes("running"));
    assert.ok(!r.ok && r.live && r.live.length === 1);
  });

  it("done task → 409", () => {
    const id = makeTask(TASK_STATUS.done);
    const r = applyTaskEdit(id, { name: "x" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);
  });

  it("status already frozen at call time → refused, row unchanged (same defence as the UPDATE's WHERE: never a silent success)", () => {
    const id = makeTask(TASK_STATUS.later);
    // Simulates the task starting just before the call; the UPDATE's WHERE carries exactly this
    // guard for the case where the initial read is stale.
    db.update(schema.tasks).set({ status: TASK_STATUS.doing }).where(eq(schema.tasks.id, id)).run();
    const before = taskRow(id)!;
    const r = applyTaskEdit(id, { name: "must not pass" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);
    assert.deepEqual(taskRow(id), before, "no row may have moved");
  });

  it("demo project → refused", () => {
    db.update(schema.projects).set({ demo: true }).where(eq(schema.projects.id, P1)).run();
    const id = makeTask(TASK_STATUS.later);
    const r = applyTaskEdit(id, { name: "x" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);
  });

  it("modelOverride is written, and `null` removes the override: complexity routing takes over again", () => {
    const id = makeTask(TASK_STATUS.later);
    const forced = applyTaskEdit(id, { modelOverride: "opus" });
    assert.ok(forced.ok);
    assert.equal(forced.ok && forced.task.modelOverride, "opus");
    const cleared = applyTaskEdit(id, { modelOverride: null });
    assert.ok(cleared.ok);
    assert.equal(cleared.ok && cleared.task.modelOverride, null);
  });

  it("partial edit: setting only priority touches neither name, agent nor brief", () => {
    const id = makeTask(TASK_STATUS.later);
    db.update(schema.tasks)
      .set({ description: "original brief" })
      .where(eq(schema.tasks.id, id))
      .run();
    const r = applyTaskEdit(id, { priority: PRIORITY.high });
    assert.ok(r.ok);
    assert.equal(r.ok && r.task.name, "original title");
    assert.equal(r.ok && r.task.assigneeAgentId, A1);
    assert.equal(r.ok && r.task.description, "original brief");
    assert.equal(r.ok && r.task.priority, "high");
  });
});
