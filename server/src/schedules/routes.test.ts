// The schedules' mutating routes over HTTP (06/09). No test opened the port, the very defect this
// domain already paid for: the screen from PR #50 called six routes nobody served.
//
// No zod schema on the body, on purpose: `validateSchedule` already is one, returns a named
// `Result` and is tested without a database. A schema on top would define the contract twice.
// These cases check that its verdict crosses Hono with its status.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-schedules-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerScheduleRoutes } = await import("./routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerScheduleRoutes(app);

const P1 = "p1";
const A1 = "a1";
const send = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
/** A schedule needs an agent OR a chain: without one, `validateSchedule` refuses before reading
 *  the cron. */
const create = (over: Record<string, unknown> = {}) =>
  send("POST", "/api/schedules", {
    projectId: P1,
    name: "nightly",
    cron: "0 3 * * *",
    agentId: A1,
    prompt: "sweep",
    ...over,
  });

beforeEach(() => {
  const now = new Date();
  db.delete(schema.scheduleRuns).run();
  db.delete(schema.schedules).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "watcher", rolePrompt: "r", createdAt: now })
    .run();
});

describe("creating a schedule", () => {
  it("the happy path returns 201 and the row reads back with its runs", async () => {
    const res = await create();
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as { id: string };

    const detail = await app.request(`/api/schedules/${id}`);
    assert.equal(detail.status, 200);
    const dto = (await detail.json()) as { name: string; cron: string; runs: unknown[] };
    assert.equal(dto.name, "nightly");
    assert.deepEqual(dto.runs, [], "the detail embeds its runs, empty at first");
  });

  it("without `projectId`: a 400 naming it, before any write", async () => {
    const res = await send("POST", "/api/schedules", {
      name: "nightly",
      cron: "0 3 * * *",
      agentId: A1,
    });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /projectId/);
    assert.equal(db.select().from(schema.schedules).all().length, 0);
  });

  it("a project that does not exist: 404, not 400, so the screen can tell", async () => {
    const res = await create({ projectId: "ghost" });
    assert.equal(res.status, 404);
    assert.match(await errorOf(res), /project not found/);
  });

  it("an agent that does not exist: 404 too, named, checked against the database", async () => {
    const res = await create({ agentId: "ghost" });
    assert.equal(res.status, 404);
    assert.match(await errorOf(res), /agent not found/);
  });

  it("an unreadable cron is refused by `validateSchedule`, with its sentence", async () => {
    const res = await create({ cron: "every tuesday" });
    assert.equal(res.status, 400);
    assert.equal(db.select().from(schema.schedules).all().length, 0);
  });
});

describe("updating and deleting", () => {
  it("a PATCH carrying only `enabled` does not erase the cron", async () => {
    const { id } = (await (await create()).json()) as { id: string };
    const res = await send("PATCH", `/api/schedules/${id}`, { enabled: false });
    assert.equal(res.status, 200);
    const dto = (await res.json()) as { cron: string; enabled: boolean };
    assert.equal(dto.enabled, false);
    assert.equal(dto.cron, "0 3 * * *", "the existing row is the base");
  });

  it("an unknown id: 404 on all three verbs, not a bare refusal", async () => {
    assert.equal((await send("PATCH", "/api/schedules/ghost", { enabled: false })).status, 404);
    assert.equal((await send("DELETE", "/api/schedules/ghost")).status, 404);
    assert.equal((await app.request("/api/schedules/ghost")).status, 404);
  });

  it("deleting returns `{ ok: true }` and the row is gone", async () => {
    const { id } = (await (await create()).json()) as { id: string };
    assert.deepEqual(await (await send("DELETE", `/api/schedules/${id}`)).json(), { ok: true });
    assert.equal(db.select().from(schema.schedules).all().length, 0);
  });

  it("a write from another origin is stopped by the middleware", async () => {
    const res = await app.request("/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ projectId: P1, name: "n", cron: "0 3 * * *", agentId: A1 }),
    });
    assert.equal(res.status, 403);
  });
});
