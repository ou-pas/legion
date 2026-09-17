// The mutating goal routes `goal-edit.test.ts` did not cover (06/09): create, approve, the three
// actions and the issue import, whose bodies arrive from the network through `goals/schemas.ts`.
//
// The model is never reached: with no credential for this project the goal is born mock and its
// DoD is built without a call (see `hasCredential`, projects/auth.ts). That makes the file
// runnable offline, and makes the 201 checked for real.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-goals-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerGoalRoutes } = await import("./routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerGoalRoutes(app);

const P1 = "p1";
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
const goalBody = { projectId: P1, name: "Ship the module", request: "do what it takes" };

beforeEach(() => {
  db.delete(schema.goalEvents).run();
  db.delete(schema.goals).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: P1, name: "P1", slug: "p1", createdAt: new Date() })
    .run();
});

describe("creating a goal", () => {
  it("happy path returns 201, and the row exists with its DoD", async () => {
    const res = await post("/api/goals", goalBody);
    assert.equal(res.status, 201);
    const out = (await res.json()) as { id: string; dod: unknown[]; warning?: string };
    assert.ok(out.id);
    assert.equal(db.select().from(schema.goals).all().length, 1);
    // 201 even when the DoD could not be written: the goal exists, and `warning` says why the DoD
    // is empty. The type in `web/src/api/goals.ts` ignored it, so the screen showed nothing.
    assert.ok(Array.isArray(out.dod) || out.warning);
  });

  it("name and request are trimmed by the schema, as the route used to do by hand", async () => {
    const { id } = (await (
      await post("/api/goals", { ...goalBody, name: "  Spaced  " })
    ).json()) as { id: string };
    const row = db
      .select()
      .from(schema.goals)
      .all()
      .find((g) => g.id === id)!;
    assert.equal(row.name, "Spaced");
  });

  it("a name made of spaces is refused by name, and nothing is created", async () => {
    const res = await post("/api/goals", { ...goalBody, name: "   " });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /name/);
    assert.equal(db.select().from(schema.goals).all().length, 0);
  });

  it("missing `projectId`: a 400 naming it", async () => {
    const res = await post("/api/goals", { name: "n", request: "r" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /projectId/);
  });

  it("an invented key is refused by name, not silently dropped", async () => {
    const res = await post("/api/goals", { ...goalBody, status: "active" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /status/);
    assert.equal(db.select().from(schema.goals).all().length, 0);
  });

  it("a create from another origin is stopped by the middleware", async () => {
    assert.equal(
      (await post("/api/goals", goalBody, { origin: "https://evil.example" })).status,
      403,
    );
  });
});

describe("approve, pause, kill", () => {
  const create = async () =>
    ((await (await post("/api/goals", goalBody)).json()) as { id: string }).id;

  it("approving a reviewed DoD makes the goal active", async () => {
    const id = await create();
    const res = await post(`/api/goals/${id}/approve`, {
      items: [{ id: "d1", text: "the tests pass" }],
    });
    assert.equal(res.status, 200);
    const row = db
      .select()
      .from(schema.goals)
      .all()
      .find((g) => g.id === id)!;
    assert.equal(row.dodApproved, true);
  });

  it("an empty DoD is refused by `goals.ts`, with its message", async () => {
    const id = await create();
    const res = await post(`/api/goals/${id}/approve`, { items: [] });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /DoD/);
  });

  it("malformed `items` is refused by the schema, naming the exact path", async () => {
    const id = await create();
    const res = await post(`/api/goals/${id}/approve`, { items: [{ id: "d1" }] });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /items\.0\.text/);
  });

  // 409, not 400 (06/09): the goal exists, its state refuses the pause. The route's `catch` returned
  // 400 for both, so the screen could not tell "nothing by that name" from "too late for that".
  it("pausing a goal that has not started is refused, saying so", async () => {
    const id = await create();
    const res = await post(`/api/goals/${id}/pause`);
    assert.equal(res.status, 409);
    assert.match(await errorOf(res), /goal is draft/);
  });

  it("unknown goal: 404 on all three actions, with its message, never a bare no", async () => {
    for (const action of ["pause", "resume", "kill"]) {
      const res = await post(`/api/goals/ghost/${action}`);
      assert.equal(res.status, 404, action);
      assert.equal(await errorOf(res), "goal not found");
    }
  });

  it("approving a DoD on an already launched goal: 409, the message names its status", async () => {
    const id = await create();
    await post(`/api/goals/${id}/approve`, { items: [{ id: "d1", text: "the tests pass" }] });
    const res = await post(`/api/goals/${id}/approve`, {
      items: [{ id: "d1", text: "the tests pass" }],
    });
    assert.equal(res.status, 409);
    assert.match(await errorOf(res), /^goal is /);
  });
});

describe("a goal from issues", () => {
  const issue = {
    identifier: "ONE-12",
    title: "fix the counter",
    url: "https://linear.app/one-12",
  };

  it("happy path: the request lists the issues, one per line", async () => {
    const res = await post("/api/goals/from-issues", { projectId: P1, issues: [issue] });
    assert.equal(res.status, 201);
    const row = db.select().from(schema.goals).all()[0]!;
    assert.match(row.request, /ONE-12: fix the counter/);
    assert.match(row.name, /1 issues/, "with no name given, it derives from the count");
  });

  it("an empty list is refused: there is nothing to process", async () => {
    const res = await post("/api/goals/from-issues", { projectId: P1, issues: [] });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /issues/);
    assert.equal(db.select().from(schema.goals).all().length, 0);
  });

  it("an issue without a URL is refused, naming the path in the array", async () => {
    const res = await post("/api/goals/from-issues", {
      projectId: P1,
      issues: [{ identifier: "ONE-12", title: "t" }],
    });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /issues\.0\.url/);
  });
});

describe("deleting a goal", () => {
  it("the footprint reads first, then deletion takes the row", async () => {
    const { id } = (await (await post("/api/goals", goalBody)).json()) as { id: string };
    assert.equal((await app.request(`/api/goals/${id}/footprint`)).status, 200);

    const res = await app.request(`/api/goals/${id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(db.select().from(schema.goals).all().length, 0);
  });

  it("unknown goal: 404 on the footprint as on the deletion", async () => {
    assert.equal((await app.request("/api/goals/ghost/footprint")).status, 404);
    assert.equal((await app.request("/api/goals/ghost", { method: "DELETE" })).status, 404);
  });
});
