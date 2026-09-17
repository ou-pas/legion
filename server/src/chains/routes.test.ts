// Catalogue routes over HTTP (06/09), and above all their status codes.
//
// `CatalogError` has long carried its status, but each route used to map it by hand through a
// `catalogFail` copied four times; one forgotten copy would have turned "already installed" (409)
// and "chain not found" (404) into 400s the screen cannot tell apart. `app.onError` maps it now,
// for every route. This file mounts it the way `http/app.ts` does and checks the statuses arrive.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-chains-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { httpErrorHandler } = await import("../http/errors.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerChainRoutes } = await import("./routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
app.onError(httpErrorHandler);
registerChainRoutes(app);

const P1 = "p1";
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
/** The library is seeded with the built-in chains: take the first one. */
const firstLibraryChain = async () =>
  (
    (await (await app.request("/api/chain-templates")).json()) as { id: string; name: string }[]
  )[0]!;

beforeEach(() => {
  db.delete(schema.taskTemplates).run();
  db.delete(schema.agents).run();
  // Since 08/09, installing `feature` installs the interviewer, which is born with an open
  // environment (D19): the `environments` row references the project, and without this delete the
  // reset hit the foreign key. Order matters: agents reference it, it references the project.
  db.delete(schema.environments).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: P1, name: "P1", slug: "p1", createdAt: new Date() })
    .run();
});

describe("installing a chain from the library", () => {
  it("happy path: 201, and the copy exists in the project", async () => {
    const chain = await firstLibraryChain();
    const res = await post(`/api/chain-templates/${chain.id}/install`, { projectId: P1 });
    assert.equal(res.status, 201);
    assert.equal(db.select().from(schema.taskTemplates).all().length, 1);
  });

  it("twice: 409 already installed, not a 400, so the screen can tell", async () => {
    const chain = await firstLibraryChain();
    await post(`/api/chain-templates/${chain.id}/install`, { projectId: P1 });
    const res = await post(`/api/chain-templates/${chain.id}/install`, { projectId: P1 });
    assert.equal(res.status, 409);
    assert.match(await errorOf(res), /already installed/);
  });

  it("a chain not in the library: 404, with its message", async () => {
    const res = await post("/api/chain-templates/ghost/install", { projectId: P1 });
    assert.equal(res.status, 404);
    assert.match(await errorOf(res), /not found/);
  });

  it("a project that does not exist: 404 too, and nothing is copied", async () => {
    const chain = await firstLibraryChain();
    const res = await post(`/api/chain-templates/${chain.id}/install`, { projectId: "ghost" });
    assert.equal(res.status, 404);
    assert.equal(db.select().from(schema.taskTemplates).all().length, 0);
  });

  it("missing `projectId`: a 400 naming it, before any catalogue read", async () => {
    const chain = await firstLibraryChain();
    const res = await post(`/api/chain-templates/${chain.id}/install`, {});
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /projectId/);
  });

  it("an invented key is refused by name", async () => {
    const chain = await firstLibraryChain();
    const res = await post(`/api/chain-templates/${chain.id}/install`, {
      projectId: P1,
      rename: "other",
    });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /rename/);
  });

  it("an install from another origin is stopped by the middleware", async () => {
    const chain = await firstLibraryChain();
    const res = await post(
      `/api/chain-templates/${chain.id}/install`,
      { projectId: P1 },
      { origin: "https://evil.example" },
    );
    assert.equal(res.status, 403);
  });
});

describe("removing a chain", () => {
  it("a built-in entry refuses deletion from the library: 409", async () => {
    const chain = await firstLibraryChain();
    const res = await app.request(`/api/chain-templates/${chain.id}`, { method: "DELETE" });
    assert.equal(res.status, 409);
  });

  it("a project's copy can be removed", async () => {
    const chain = await firstLibraryChain();
    const { id } = (await (
      await post(`/api/chain-templates/${chain.id}/install`, { projectId: P1 })
    ).json()) as { id: string };
    assert.equal((await app.request(`/api/templates/${id}`, { method: "DELETE" })).status, 200);
    assert.equal(db.select().from(schema.taskTemplates).all().length, 0);
  });

  it("a copy that does not exist: 404, never a bare no", async () => {
    assert.equal((await app.request("/api/templates/ghost", { method: "DELETE" })).status, 404);
  });
});

describe("running a chain", () => {
  it("an empty request is refused by the schema, naming the key", async () => {
    const res = await post("/api/templates/ghost/run", { request: "   " });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /request/);
  });

  // 404, not 400 (06/09): the id designates nothing, the request is not at fault. The route's
  // `catch` used to flatten both to 400.
  it("an unknown chain is refused with a message, and no task is created", async () => {
    const res = await post("/api/templates/ghost/run", { request: "do something" });
    assert.equal(res.status, 404);
    assert.equal(await errorOf(res), "template not found");
    assert.equal(db.select().from(schema.tasks).all().length, 0);
  });
});
