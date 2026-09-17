// The human PATCH's guards, which lived in a 104-line route callback and could only be exercised by
// mounting a Hono app.
//
//  1. everything is refused before anything is written: a mixed PATCH (a legitimate setting + a
//     forbidden status) must not leave half its effect behind;
//  2. the three named refusals: forbidden transition, archiving an unfinished task, brief rewritten
//     under a live session (with the session list, so the screen shows them);
//  3. finishing a task releases its dependents, and postponing a task takes it out of the queue.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-task-patch-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { applyTaskPatch } = await import("./task-patch.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { COMPLEXITY } = await import("./task-scales.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p1";
const A = "a1";
const RUNNER = "r1";

beforeEach(() => {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.taskBlockers).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "build", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "local", kind: RUNNER_KIND.process }).run();
});

type Status = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

function seedTask(
  id: string,
  status: Status = TASK_STATUS.todo,
  extra: Record<string, unknown> = {},
) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: P,
      name: id,
      status,
      assigneeAgentId: A,
      createdAt: now,
      updatedAt: now,
      ...extra,
    })
    .run();
  return id;
}

function seedLiveSession(taskId: string) {
  db.insert(schema.sessions)
    .values({
      id: `s-${taskId}`,
      taskId,
      agentId: A,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: `tok-${taskId}`,
      startedAt: new Date(),
    })
    .run();
}

const read = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();

describe("shape refusals", () => {
  it("a body with no field is refused, listing what is expected", () => {
    seedTask("t1");
    const res = applyTaskPatch("t1", {});
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 400);
      assert.match(res.error, /status, archived, description/);
    }
  });

  it("an unknown task returns 404 rather than a 200 with a null body", () => {
    const res = applyTaskPatch("never-seen", { status: TASK_STATUS.done });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 404);
  });
});

describe("status and archiving guards", () => {
  it("later cannot be reached from started work", () => {
    seedTask("t1", TASK_STATUS.doing);
    const res = applyTaskPatch("t1", { status: TASK_STATUS.later });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 400);
    assert.equal(read("t1")?.status, TASK_STATUS.doing, "nothing may have moved");
  });

  it("only a done task can be archived", () => {
    seedTask("t1", TASK_STATUS.todo);
    const res = applyTaskPatch("t1", { archived: true });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /only a done task/);
  });

  it("finishing and archiving in one gesture is allowed", () => {
    seedTask("t1", TASK_STATUS.review);
    const res = applyTaskPatch("t1", { status: TASK_STATUS.done, archived: true });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.task.archived, true);
  });

  it("postponing a task takes it out of the queue", () => {
    seedTask("t1", TASK_STATUS.todo, { queued: true });
    const res = applyTaskPatch("t1", { status: TASK_STATUS.later });
    assert.equal(res.ok, true);
    assert.equal(read("t1")?.queued, false);
  });
});

describe("the brief", () => {
  it("a live session freezes it, and the refusal names the running sessions", () => {
    seedTask("t1", TASK_STATUS.doing);
    seedLiveSession("t1");
    const res = applyTaskPatch("t1", { description: "too late" });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 409);
      assert.match(res.error, /brief has already gone out/);
      assert.deepEqual(
        res.live?.map((s) => s.id),
        ["s-t1"],
      );
    }
  });

  it("between two sessions it can be amended, whatever status was reached", () => {
    seedTask("t1", TASK_STATUS.review);
    const res = applyTaskPatch("t1", { description: "the corrected instruction" });
    assert.equal(res.ok, true);
    assert.equal(read("t1")?.description, "the corrected instruction");
  });
});

describe("nothing is written when a refusal follows", () => {
  it("a legitimate setting posted with a forbidden status is not applied", () => {
    seedTask("t1", TASK_STATUS.doing, { complexity: COMPLEXITY.med });
    const res = applyTaskPatch("t1", { complexity: COMPLEXITY.high, status: TASK_STATUS.later });
    assert.equal(res.ok, false);
    assert.equal(read("t1")?.complexity, COMPLEXITY.med, "the refusal must precede any write");
  });

  it("a setting on a started task is refused by its own module, with 409", () => {
    seedTask("t1", TASK_STATUS.doing);
    const res = applyTaskPatch("t1", { name: "another title" });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 409);
  });
});

describe("finishing releases dependents", () => {
  // The dependent is parked in later on purpose: the link is consumed whatever its status
  // (behaviour 8, "at that instant"), but only a `todo` starts, and starting it would launch a real
  // runner from this unit test.
  it("the blocker link is consumed in the finishing transaction, even on a parked dependent", () => {
    seedTask("blocker", TASK_STATUS.review);
    seedTask("blocked", TASK_STATUS.later);
    db.insert(schema.taskBlockers)
      .values({ taskId: "blocked", blockerId: "blocker", createdAt: new Date() })
      .run();

    const res = applyTaskPatch("blocker", { status: TASK_STATUS.done });
    assert.equal(res.ok, true);
    assert.deepEqual(db.select().from(schema.taskBlockers).all(), [], "the link must be consumed");
    assert.equal(
      read("blocked")?.status,
      TASK_STATUS.later,
      "an unlinked parked task stays parked",
    );
  });
});
