// Route wiring, not rules (those are in environments.test.ts). The UI once shipped against a
// contract with no route behind it, which a service-only test would not catch. These go through
// Hono with the paths and shapes `web/src/api/environments.ts` actually sends.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-env-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerEnvironmentRoutes } = await import("./routes.js");

const app = new Hono();
// The real middleware is mounted (06/09): a bare `new Hono()` has no guard, and the last case
// must test what protects the route in production, not a local copy.
app.use("*", mutationOriginGuard);
registerEnvironmentRoutes(app);

const P1 = "p1";
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

beforeEach(() => {
  db.delete(schema.agents).run();
  db.delete(schema.environments).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: P1, name: "P1", slug: "p1", createdAt: new Date() })
    .run();
});

describe("the four routes the UI calls", () => {
  it("POST then GET: the list returns `allowedHosts` as an array, not stored JSON", async () => {
    const created = await post("/api/environments", {
      projectId: P1,
      name: "ci",
      allowedHosts: ["github.com"],
    });
    assert.equal(created.status, 201);

    const list = await app.request(`/api/environments?projectId=${P1}`);
    assert.equal(list.status, 200);
    const rows = (await list.json()) as {
      name: string;
      networking: string;
      allowedHosts: string[];
    }[];
    assert.equal(rows.length, 1);
    assert.deepEqual(
      rows[0]!.allowedHosts,
      ["github.com"],
      "an array: the client calls .join on it",
    );
    assert.equal(rows[0]!.networking, "limited");
  });

  it("GET filters by project: another project's environment does not leak", async () => {
    db.insert(schema.projects)
      .values({ id: "p2", name: "P2", slug: "p2", createdAt: new Date() })
      .run();
    await post("/api/environments", { projectId: P1, name: "here", allowedHosts: [] });
    await post("/api/environments", { projectId: "p2", name: "elsewhere", allowedHosts: [] });
    const rows = (await (await app.request(`/api/environments?projectId=${P1}`)).json()) as {
      name: string;
    }[];
    assert.deepEqual(
      rows.map((r) => r.name),
      ["here"],
    );
  });

  it("PATCH returns the updated row: the client reads it without another GET", async () => {
    const env = (await (
      await post("/api/environments", { projectId: P1, name: "ci", allowedHosts: [] })
    ).json()) as { id: string };
    const r = await patch(`/api/environments/${env.id}`, { allowedHosts: ["registry.npmjs.org"] });
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as { allowedHosts: string[] }).allowedHosts, [
      "registry.npmjs.org",
    ]);
  });

  it("a refused host returns 400 with a sentence the UI shows as is", async () => {
    const r = await post("/api/environments", {
      projectId: P1,
      name: "ci",
      allowedHosts: ["https://github.com/x"],
    });
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, /with no scheme and no path/);
  });

  it("DELETE refuses with 409 and names the agents, with the list next to the sentence", async () => {
    const env = (await (
      await post("/api/environments", { projectId: P1, name: "ci", allowedHosts: [] })
    ).json()) as { id: string };
    db.insert(schema.agents)
      .values({
        id: "a1",
        projectId: P1,
        name: "front",
        rolePrompt: "r",
        environmentId: env.id,
        createdAt: new Date(),
      })
      .run();

    const r = await app.request(`/api/environments/${env.id}`, { method: "DELETE" });
    assert.equal(r.status, 409);
    const body = (await r.json()) as { error: string; agentNames: string[] };
    assert.match(body.error, /front/);
    assert.deepEqual(body.agentNames, ["front"]);
  });

  it("DELETE passes once no agent carries it", async () => {
    const env = (await (
      await post("/api/environments", { projectId: P1, name: "ci", allowedHosts: [] })
    ).json()) as { id: string };
    assert.equal(
      (await app.request(`/api/environments/${env.id}`, { method: "DELETE" })).status,
      200,
    );
    assert.deepEqual(await (await app.request(`/api/environments?projectId=${P1}`)).json(), []);
  });

  it("refuses a write from a foreign origin: this sets a network wall", async () => {
    const env = (await (
      await post("/api/environments", { projectId: P1, name: "ci", allowedHosts: [] })
    ).json()) as { id: string };
    const r = await app.request(`/api/environments/${env.id}`, {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(r.status, 403);
  });
});
