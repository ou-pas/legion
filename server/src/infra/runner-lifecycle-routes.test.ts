// `PATCH /api/runners/:id { enabled }` and `DELETE /api/runners/:id`: the HTTP wiring only
// (runner/lifecycle.ts holds and tests the logic). Checks the route exists at the path the screen
// calls and its verdict (200/404/409) crosses Hono intact.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-runner-lifecycle-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_INFRA_FAKE = "1";
after(() => {
  delete process.env.LEGION_INFRA_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const { db, schema } = await import("../shared/db.js");
const { registerInfraRoutes } = await import("./routes.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { httpErrorHandler } = await import("../http/errors.js");

const app = new Hono();
// As in the real app (06/09): `errors.ts` gives exceptions their status.
app.onError(httpErrorHandler);
registerInfraRoutes(app);

const RUNNER = "r1";
const P1 = "p1";
const A1 = "a1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects)
    .values({ id: P1, name: "P1", slug: "p1", createdAt: now, demo: false })
    .run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "a1", rolePrompt: "role", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.docker }).run();
}
beforeEach(() => reset());

const patchRunner = (id: string, body: unknown) =>
  app.request(`/api/runners/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const delRunner = (id: string) => app.request(`/api/runners/${id}`, { method: "DELETE" });

describe("PATCH /api/runners/:id { enabled }", () => {
  it("disables, cleans up, and reads back from the database", async () => {
    const res = await patchRunner(RUNNER, { enabled: false });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      runner: { enabled: boolean };
      cleanup: { removed: string[] };
    };
    assert.equal(body.runner.enabled, false);
    assert.ok(body.cleanup.removed.length > 0, "cleanup ran in the same action");
    assert.equal(
      db.select().from(schema.runners).where(eq(schema.runners.id, RUNNER)).get()!.enabled,
      false,
    );
  });

  it("non-boolean enabled → 400", async () => {
    const res = await patchRunner(RUNNER, { enabled: "false" });
    assert.equal(res.status, 400);
  });

  it("unknown runner → 404", async () => {
    assert.equal((await patchRunner("nope", { enabled: false })).status, 404);
  });

  it("live session → 409, names the session", async () => {
    const now = new Date();
    const taskId = "t1";
    db.insert(schema.tasks)
      .values({
        id: taskId,
        projectId: P1,
        name: "t",
        assigneeAgentId: A1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId,
        agentId: A1,
        runnerId: RUNNER,
        model: "sonnet",
        status: "running",
        callbackToken: "tok",
        startedAt: now,
      })
      .run();
    const res = await patchRunner(RUNNER, { enabled: false });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { live: { id: string }[] };
    assert.equal(body.live[0]!.id, "s1");
  });
});

describe("DELETE /api/runners/:id", () => {
  it("a never-used runner disappears, with its cleanup", async () => {
    const res = await delRunner(RUNNER);
    assert.equal(res.status, 200);
    assert.equal(
      db.select().from(schema.runners).where(eq(schema.runners.id, RUNNER)).get(),
      undefined,
    );
  });

  it("unknown runner → 404", async () => {
    assert.equal((await delRunner("nope")).status, 404);
  });

  it("a runner that already had a session → 409, the row stays", async () => {
    const now = new Date();
    const taskId = "t1";
    db.insert(schema.tasks)
      .values({
        id: taskId,
        projectId: P1,
        name: "t",
        assigneeAgentId: A1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId,
        agentId: A1,
        runnerId: RUNNER,
        model: "sonnet",
        status: "destroyed",
        callbackToken: "tok",
        startedAt: now,
      })
      .run();
    const res = await delRunner(RUNNER);
    assert.equal(res.status, 409);
    assert.ok(db.select().from(schema.runners).where(eq(schema.runners.id, RUNNER)).get());
  });
});
