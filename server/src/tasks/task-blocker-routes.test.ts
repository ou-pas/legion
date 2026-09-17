// The wiring of the new entry door ("set a dependency between tasks from the API"):
// `blockers.test.ts` and `task-blocker-edit.test.ts` cover the rules; here we check `POST`/`PATCH
// /api/tasks` really apply them, through Hono, like `task-list-detail.test.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";
import type { TaskStatus } from "./lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-task-blocker-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerTaskRoutes } = await import("./routes/index.js");
const { blockersOf } = await import("./blockers.js");
const { runTask } = await import("../sessions/runner/manager.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerTaskRoutes(app);

const P1 = "p1";
const A1 = "a1";
const RUNNER = "r1";

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
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
}

function makeTask(id: string, status: TaskStatus = TASK_STATUS.todo) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: P1,
      name: id,
      status,
      assigneeAgentId: A1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (path: string, body: unknown) =>
  app.request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/tasks with blockerIds", () => {
  beforeEach(() => reset());

  it("creates the task and the link, in the same response (blockedBy)", async () => {
    makeTask("A");
    const res = await post("/api/tasks", {
      name: "dependent",
      agentId: A1,
      projectId: P1,
      blockerIds: ["A"],
    });
    assert.equal(res.status, 201);
    const task = (await res.json()) as { id: string; blockedBy: { id: string }[] };
    assert.deepEqual(
      task.blockedBy.map((b) => b.id),
      ["A"],
    );
    assert.deepEqual(blockersOf(task.id), ["A"]);
  });

  it("unknown blocker → 400, the task is not created", async () => {
    const before = db.select().from(schema.tasks).all().length;
    const res = await post("/api/tasks", {
      name: "x",
      agentId: A1,
      projectId: P1,
      blockerIds: ["does-not-exist"],
    });
    assert.equal(res.status, 400);
    assert.equal(
      db.select().from(schema.tasks).all().length,
      before,
      "no row created on a refused link",
    );
  });

  it("blocker already done → 400", async () => {
    makeTask("A", TASK_STATUS.done);
    const res = await post("/api/tasks", {
      name: "x",
      agentId: A1,
      projectId: P1,
      blockerIds: ["A"],
    });
    assert.equal(res.status, 400);
  });

  it("blocker from another project → 400", async () => {
    const now = new Date();
    db.insert(schema.projects).values({ id: "p2", name: "P2", slug: "p2", createdAt: now }).run();
    db.insert(schema.tasks)
      .values({
        id: "foreign",
        projectId: "p2",
        name: "Elsewhere",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const res = await post("/api/tasks", {
      name: "x",
      agentId: A1,
      projectId: P1,
      blockerIds: ["foreign"],
    });
    assert.equal(res.status, 400);
  });

  it("blockerIds is not an array → 400", async () => {
    const res = await post("/api/tasks", {
      name: "x",
      agentId: A1,
      projectId: P1,
      blockerIds: "A",
    });
    assert.equal(res.status, 400);
  });

  it("without blockerIds: unchanged behaviour, no link", async () => {
    const res = await post("/api/tasks", { name: "x", agentId: A1, projectId: P1 });
    assert.equal(res.status, 201);
    const task = (await res.json()) as { id: string; blockedBy: unknown[] };
    assert.deepEqual(task.blockedBy, []);
  });
});

describe("PATCH /api/tasks/:id with addBlockerIds/removeBlockerIds", () => {
  beforeEach(() => reset());

  it("adds a blocker on a later task", async () => {
    makeTask("A");
    const t = makeTask("t", TASK_STATUS.later);
    const res = await patch(`/api/tasks/${t}`, { addBlockerIds: ["A"] });
    assert.equal(res.status, 200);
    assert.deepEqual(blockersOf(t), ["A"]);
  });

  it("removes a blocker", async () => {
    makeTask("A");
    const t = makeTask("t", TASK_STATUS.later);
    await patch(`/api/tasks/${t}`, { addBlockerIds: ["A"] });
    const res = await patch(`/api/tasks/${t}`, { removeBlockerIds: ["A"] });
    assert.equal(res.status, 200);
    assert.deepEqual(blockersOf(t), []);
  });

  // 10/09: status froze nothing a live session did not already freeze (`areBlockersEditable`). A
  // `doing` task without a session is between two launches, and its blocker decides the next one;
  // this is the gesture that repairs a wrongly set link.
  it("accepted on a doing task without a session: the blocker targets the next launch", async () => {
    const a = makeTask("A");
    const t = makeTask("t", TASK_STATUS.doing);
    const res = await patch(`/api/tasks/${t}`, { addBlockerIds: [a] });
    assert.equal(res.status, 200);
    assert.deepEqual(blockersOf(t), [a]);
  });

  it("cycle refused: 400, no link set", async () => {
    const a = makeTask("A");
    const t = makeTask("t", TASK_STATUS.later);
    await patch(`/api/tasks/${a}`, { addBlockerIds: [t] }); // A waits for t
    const res = await patch(`/api/tasks/${t}`, { addBlockerIds: [a] }); // t would wait for A → cycle
    assert.equal(res.status, 400);
    assert.deepEqual(blockersOf(t), []);
  });
});

describe("a task blocked by a link set through the new route is not taken by the queue", () => {
  beforeEach(() => reset());

  it("POST with blockerIds: runTask refuses while the blocker is not finished", async () => {
    makeTask("A");
    const res = await post("/api/tasks", {
      name: "dependent",
      agentId: A1,
      projectId: P1,
      blockerIds: ["A"],
      status: TASK_STATUS.todo,
    });
    assert.equal(res.status, 201);
    const task = (await res.json()) as { id: string };
    await assert.rejects(runTask(task.id), (err: Error) => {
      assert.match(err.message, /blocked by/);
      assert.match(err.message, /“A” \(todo\)/);
      return true;
    });
  });

  it("PATCH addBlockerIds on a task already todo: runTask refuses afterwards", async () => {
    makeTask("A");
    const t = makeTask("t", TASK_STATUS.todo);
    const res = await patch(`/api/tasks/${t}`, { addBlockerIds: ["A"] });
    assert.equal(res.status, 200);
    await assert.rejects(runTask(t), /blocked by/);
  });
});
