// The domain's least tested layer: the routes themselves.
//
// Before the 06/09 split, the task routes had no test next to them: the domain's only HTTP calls
// came from two files mounting an app to test something else (attachments, binary). A 404 turned
// 200, a refused body turned accepted, and nobody would have noticed.
//
// Minimal mount: in-memory Hono, SQLite and disk in a temporary folder, same as
// `attachments-http.test.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-routes-crud-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { registerTaskRoutes } = await import("./index.js");
const { TASK_STATUS } = await import("../lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");

const app = new Hono();
registerTaskRoutes(app);

const P = "p1";
const A = "a1";
const now = new Date();

db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: A, projectId: P, name: "build", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "local", kind: RUNNER_KIND.process }).run();
db.insert(schema.tasks)
  .values([
    {
      id: "free",
      projectId: P,
      name: "a free task",
      status: TASK_STATUS.todo,
      assigneeAgentId: A,
      description: "the whole brief",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "finished",
      projectId: P,
      name: "a finished task",
      status: TASK_STATUS.done,
      assigneeAgentId: A,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "busy",
      projectId: P,
      name: "a busy task",
      status: TASK_STATUS.doing,
      assigneeAgentId: A,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "busy",
    agentId: A,
    runnerId: "r1",
    model: "sonnet",
    status: "running",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();

const get = (path: string) => app.request(path);
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("reads", () => {
  it("the board returns summaries without the brief, and the sessions alongside", async () => {
    const res = await get("/api/tasks");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { tasks: Record<string, unknown>[]; sessions: unknown[] };
    assert.equal(body.tasks.length, 3);
    assert.equal(
      body.tasks.every((t) => !("description" in t)),
      true,
      "a summary does not carry the brief",
    );
    assert.equal(body.sessions.length, 1);
  });

  it("one task's record carries the whole brief; an unknown id returns 404", async () => {
    const one = await get("/api/tasks/free");
    assert.equal(one.status, 200);
    assert.equal(((await one.json()) as { description: string }).description, "the whole brief");
    assert.equal((await get("/api/tasks/never-seen")).status, 404);
  });

  it("lineage and activity answer even when there is nothing to show", async () => {
    assert.equal((await get("/api/tasks/free/links")).status, 200);
    assert.deepEqual(await (await get("/api/tasks/free/activity")).json(), []);
  });
});

describe("deletion", () => {
  it("refuses while a session runs, with 409 and naming the session", async () => {
    const res = await app.request("/api/tasks/busy", { method: "DELETE" });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string; live: { id: string }[] };
    assert.match(body.error, /stop it first/);
    assert.deepEqual(
      body.live.map((s) => s.id),
      ["s1"],
    );
  });

  it("an unknown task returns 404 rather than ok on nothing", async () => {
    assert.equal((await app.request("/api/tasks/never-seen", { method: "DELETE" })).status, 404);
  });

  it("deletes an idle task and returns its name", async () => {
    const res = await app.request("/api/tasks/free", { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { deleted: string }).deleted, "a free task");
    assert.equal((await get("/api/tasks/free")).status, 404);
  });
});

describe("bulk archive", () => {
  it("refuses a body without a project, and names the faulty key", async () => {
    const res = await post("/api/tasks/archive-done", {});
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /projectId/);
  });

  it("refuses an unknown key rather than ignoring it", async () => {
    const res = await post("/api/tasks/archive-done", { projectId: P, status: "done" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /status/);
  });

  it("only archives done tasks, and returns the count", async () => {
    const res = await post("/api/tasks/archive-done", { projectId: P });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { archived: number }).archived, 1);
    // Replayed, it counts nothing: "nothing to archive" is not an error.
    assert.equal(
      (
        (await (await post("/api/tasks/archive-done", { projectId: P })).json()) as {
          archived: number;
        }
      ).archived,
      0,
    );
  });
});
