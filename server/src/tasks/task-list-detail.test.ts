// The 02/09 cut (measured: /api/tasks returned 108 full tasks to paint board cards):
// `GET /api/tasks` returns summaries, `GET /api/tasks/:id` carries the full record. End to end, like
// `artifacts-binary-http.test.ts`: in-memory Hono, database in a temporary folder.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-task-list-detail-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerTaskRoutes } = await import("./routes/index.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const app = new Hono();
registerTaskRoutes(app);

const PROJECT = "p1";
const AGENT = "a1";
const TASK = "t1";

const now = new Date();
db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: AGENT, projectId: PROJECT, name: "build", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values({
    id: TASK,
    projectId: PROJECT,
    name: "task",
    status: TASK_STATUS.todo,
    assigneeAgentId: AGENT,
    description: "a brief the card never shows",
    criteria: '{"validatedBy":"x","items":[]}',
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("task list vs detail", () => {
  it("GET /api/tasks carries neither description nor criteria", async () => {
    const res = await app.request("/api/tasks");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { tasks: Record<string, unknown>[] };
    const task = body.tasks.find((t) => t.id === TASK);
    assert.ok(task, "the task must appear in the list");
    assert.equal("description" in task!, false);
    assert.equal("criteria" in task!, false);
    // What a card shows stays.
    assert.equal(task!.name, "task");
    assert.equal(task!.status, TASK_STATUS.todo);
    assert.equal(task!.assigneeAgentId, AGENT);
  });

  it("GET /api/tasks/:id carries the full record, brief and criteria included", async () => {
    const res = await app.request(`/api/tasks/${TASK}`);
    assert.equal(res.status, 200);
    const task = (await res.json()) as Record<string, unknown>;
    assert.equal(task.id, TASK);
    assert.equal(task.description, "a brief the card never shows");
    assert.equal(task.criteria, '{"validatedBy":"x","items":[]}');
  });

  it("GET /api/tasks/:id on an unknown id returns 404", async () => {
    const res = await app.request("/api/tasks/unknown");
    assert.equal(res.status, 404);
  });
});
