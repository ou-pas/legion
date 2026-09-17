// The domain's four mutating bodies go through a schema before reaching the database, and their
// refusals carry the faulty key's name.
//
// The original defect: `complexity` and `priority` are ENUM columns and were unchecked, so "huge"
// reached the database and `task-scales.ts`'s type then lied to everything reading them (model
// routing, queue order). `type` was already refused by hand: the guard covered one column in three.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-routes-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { registerTaskRoutes } = await import("./index.js");
const { TASK_STATUS } = await import("../lifecycle.js");

const app = new Hono();
registerTaskRoutes(app);

const P = "p1";
const A = "a1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: A, projectId: P, name: "build", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values({
    id: "existing",
    projectId: P,
    name: "already there",
    status: TASK_STATUS.todo,
    assigneeAgentId: A,
    createdAt: now,
    updatedAt: now,
  })
  .run();

const send = (method: string, path: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
const create = (body: unknown) => send("POST", "/api/tasks", body);
const valid = { name: "set up the harness", agentId: A, projectId: P };

describe("POST /api/tasks", () => {
  it("creates, returns 201 and the re-read row, default columns included", async () => {
    const res = await create({ ...valid, complexity: "high" });
    assert.equal(res.status, 201);
    const task = (await res.json()) as {
      id: string;
      queued: boolean;
      complexity: string;
      type: string;
    };
    assert.equal(task.queued, false, "the column filled by the database must be in the response");
    assert.equal(task.complexity, "high");
    assert.equal(task.type, "chore");
    assert.equal((await app.request(`/api/tasks/${task.id}`)).status, 200);
  });

  it("refuses an unknown complexity, the gap this batch closes", async () => {
    const res = await create({ ...valid, complexity: "huge" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /complexity/);
  });

  it("also refuses an unknown priority and type, with the same named message", async () => {
    assert.match(await errorOf(await create({ ...valid, priority: "super-urgent" })), /priority/);
    assert.match(await errorOf(await create({ ...valid, type: "refactoring" })), /type/);
  });

  it("refuses an unknown key rather than letting it through silently", async () => {
    assert.match(await errorOf(await create({ ...valid, assigneeAgentId: A })), /assigneeAgentId/);
  });

  it("refuses a forbidden birth status: a task is not born doing", async () => {
    assert.equal((await create({ ...valid, status: "doing" })).status, 400);
    assert.equal((await create({ ...valid, status: "later" })).status, 201);
  });

  it("refuses an unknown blocker, and creates nothing", async () => {
    const before = db.select().from(schema.tasks).all().length;
    const res = await create({ ...valid, blockerIds: ["ghost"] });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /not found/);
    assert.equal(db.select().from(schema.tasks).all().length, before);
  });
});

describe("PATCH /api/tasks/:id", () => {
  it("amends the brief and returns the re-read row", async () => {
    const res = await send("PATCH", "/api/tasks/existing", {
      description: "the corrected instruction",
    });
    assert.equal(res.status, 200);
    assert.equal(
      ((await res.json()) as { description: string }).description,
      "the corrected instruction",
    );
  });

  it("refuses a status outside the five, and an unknown key", async () => {
    assert.equal((await send("PATCH", "/api/tasks/existing", { status: "almost" })).status, 400);
    assert.match(
      await errorOf(await send("PATCH", "/api/tasks/existing", { state: "done" })),
      /state/,
    );
  });

  it("a body with no field is refused, listing what is expected", async () => {
    const res = await send("PATCH", "/api/tasks/existing", {});
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /status, archived, description/);
  });

  it("an unknown task returns 404", async () => {
    assert.equal((await send("PATCH", "/api/tasks/never-seen", { status: "done" })).status, 404);
  });
});

describe("POST /api/tasks/:id/move", () => {
  it("moves, and returns the task with the rebalance flag", async () => {
    const res = await send("POST", "/api/tasks/existing/move", {
      status: TASK_STATUS.later,
      index: 0,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { task: { status: string }; rebalanced: boolean };
    assert.equal(body.task.status, TASK_STATUS.later);
    assert.equal(typeof body.rebalanced, "boolean");
  });

  it("a drop without a rank is refused: it always carries both", async () => {
    const res = await send("POST", "/api/tasks/existing/move", { status: "todo" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /index/);
  });

  it("an unknown task returns 404, not 400", async () => {
    assert.equal(
      (await send("POST", "/api/tasks/never-seen/move", { status: "todo", index: 0 })).status,
      404,
    );
  });
});

describe("POST /api/tasks/classify", () => {
  it("refuses a blank title before any model call", async () => {
    const res = await send("POST", "/api/tasks/classify", { projectId: P, name: "   " });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /name/);
  });

  it("refuses an unknown key in the operator's pins", async () => {
    const res = await send("POST", "/api/tasks/classify", {
      projectId: P,
      name: "x",
      forced: { modelName: "opus" },
    });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /modelName/);
  });
});
