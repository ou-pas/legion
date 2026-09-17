// The two batch routes answer without the screen having to know, when asking, whether the task
// approves a batch.
//
// `approvesLot: false` rather than a 400 is the point: the flag lives in the template, not on the
// task row, so a step page in review cannot know before asking. A refusal would force every chain
// page to handle an expected answer as a failure.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-routes-lot-"));
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
    id: "free",
    projectId: P,
    name: "a task without a chain",
    status: TASK_STATUS.review,
    assigneeAgentId: A,
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("GET /api/tasks/:id/lot", () => {
  it("a task approving no batch answers 200 and says so, never an error", async () => {
    const res = await app.request("/api/tasks/free/lot");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { approvesLot: false, slices: [], faults: [] });
  });

  it("an unknown task returns 404", async () => {
    assert.equal((await app.request("/api/tasks/never-seen/lot")).status, 404);
  });
});

describe("POST /api/tasks/:id/approve-lot", () => {
  it("an unknown task returns 404, with an empty fault list rather than none", async () => {
    const res = await app.request("/api/tasks/never-seen/approve-lot", { method: "POST" });
    assert.equal(res.status, 404);
    assert.deepEqual(((await res.json()) as { faults: string[] }).faults, []);
  });

  it("a task outside a chain is refused by name, not with a 500", async () => {
    const res = await app.request("/api/tasks/free/approve-lot", { method: "POST" });
    assert.equal(res.status >= 400 && res.status < 500, true, `unexpected status: ${res.status}`);
    assert.ok(((await res.json()) as { error: string }).error.length > 0);
  });
});
