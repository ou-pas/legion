// The mapping of launch faults to an HTTP status.
//
// The only place in the domain where an exception (not a `Result`) crosses the boundary: `runTask`
// throws, the route catches and returns 400, including for full capacity, which cannot happen here
// since the human launch queues (`enqueueOnFull`) instead of failing. This net is checked nowhere
// else, and a global `onError` placed above it one day would replace it silently.
//
// No successful launch here: it would start a real runtime. Refusals are exercised, and that is
// where the HTTP contract is decided.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-routes-run-"));
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
    id: "finished",
    projectId: P,
    name: "already done",
    status: TASK_STATUS.done,
    assigneeAgentId: A,
    createdAt: now,
    updatedAt: now,
  })
  .run();

const post = (path: string, body?: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("POST /api/tasks/:id/run", () => {
  it("an unknown task returns 400 with the service message, never a bare 500", async () => {
    const res = await post("/api/tasks/never-seen/run");
    assert.equal(res.status, 400);
    const { error } = (await res.json()) as { error: string };
    assert.ok(error.length > 0, "the refusal must carry a readable message");
  });
});

describe("POST /api/tasks/:id/message", () => {
  it("refuses a body without text, naming the key", async () => {
    const res = await post("/api/tasks/finished/message", {});
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /text/);
  });

  it("refuses a text that is not one", async () => {
    assert.equal((await post("/api/tasks/finished/message", { text: 42 })).status, 400);
  });

  it("refuses an unknown key rather than ignoring it", async () => {
    const res = await post("/api/tasks/finished/message", { text: "hi", steer: true });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /steer/);
  });

  it("unreadable JSON is a 400 of the same family, not an exception", async () => {
    const res = await app.request("/api/tasks/finished/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /unreadable JSON/);
  });

  it("an unknown task returns 404: the service decides, the route relays its status", async () => {
    const res = await post("/api/tasks/never-seen/message", { text: "anyone there?" });
    assert.equal(res.status, 404);
  });
});
