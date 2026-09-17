// `POST /api/runners`: declaring a machine (01/09, multi-machine work, slice 01).
//
// Through Hono, not the service alone: screen and server share only a string, and calling the
// function does not prove the route exists at the path the screen sends. A mistyped `ssh://` URL
// accepted silently is only discovered at the first session, as an unreadable clone error.
//
// The new runner is probed before answering, or `pickRunnerRow` would leave a thirty-second grey
// zone. `LEGION_INFRA_FAKE=1` stands in for the daemon: the probe says yes without calling docker.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-declare-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_INFRA_FAKE = "1";
after(() => {
  delete process.env.LEGION_INFRA_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

const { db, schema } = await import("../../shared/db.js");
const { eq } = await import("drizzle-orm");
const { registerInfraRoutes } = await import("../routes.js");
const { runnerReachable } = await import("../probe.js");
const { httpErrorHandler } = await import("../../http/errors.js");

const app = new Hono();
// As in the real app (06/09): `errors.ts` gives exceptions their status; without it a test would
// see Hono's default 500 where the app returns 404 or 502.
app.onError(httpErrorHandler);
registerInfraRoutes(app);

type Declared = {
  id: string;
  name: string;
  dockerHost: string | null;
  callbackUrl: string | null;
  maxConcurrentSessions: number;
  reachable: boolean;
  error: string | null;
};

const declare = (body: unknown) =>
  app.request("/api/runners", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db.delete(schema.sessions).run();
  db.delete(schema.runners).run();
});

describe("POST /api/runners: what is accepted", () => {
  it("an ssh:// host with its cap and callback address: created, and probed immediately", async () => {
    const res = await declare({
      name: "mac-mini",
      dockerHost: "ssh://operator@192.168.1.20",
      callbackUrl: "http://100.64.0.1:8790",
      maxConcurrentSessions: 4,
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as Declared;
    assert.equal(body.name, "mac-mini");
    assert.equal(body.dockerHost, "ssh://operator@192.168.1.20");
    assert.equal(body.callbackUrl, "http://100.64.0.1:8790");
    assert.equal(body.maxConcurrentSessions, 4);
    assert.equal(body.reachable, true, "the response SAYS whether it answers");
    assert.equal(body.error, null);

    const row = db.select().from(schema.runners).where(eq(schema.runners.id, body.id)).get()!;
    assert.equal(row.kind, "docker");
    assert.equal(row.enabled, true);
    assert.ok(row.lastSeenAt, "probed on POST: no grey zone before the first pass");
    assert.equal(
      runnerReachable(row),
      true,
      "it can receive a session without waiting for the loop",
    );
  });

  it("without cap or callback address: the default, and null", async () => {
    const body = (await (await declare({ name: "local-2" })).json()) as Declared;
    assert.equal(body.dockerHost, null);
    assert.equal(body.callbackUrl, null);
    assert.equal(body.maxConcurrentSessions, 3);
  });
});

describe("POST /api/runners: what is refused, saying so", () => {
  // 409, not 400 (06/09): the body is fine, the fleet already has that name.
  it("a duplicate name names the name", async () => {
    assert.equal((await declare({ name: "mac-mini" })).status, 201);
    const res = await declare({ name: "mac-mini", dockerHost: "ssh://elsewhere" });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /mac-mini/);
    assert.equal(db.select().from(schema.runners).all().length, 1, "nothing written on a refusal");
  });

  it("an empty name is refused", async () => {
    const res = await declare({ name: "   " });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /a name is required/);
  });

  // Wave 2 (06/09): an invented key used to be silently ignored and the screen believed it had set
  // something. `declare.ts` judges values; the schema closes the key set.
  it("an invented key is refused BY NAME, and nothing is written", async () => {
    const res = await declare({ name: "mac-mini", enabled: true });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /enabled/);
    assert.equal(db.select().from(schema.runners).all().length, 0);
  });

  it("a non-JSON body is a 400, not a 500", async () => {
    const res = await app.request("/api/runners", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /unreadable JSON/);
  });

  it("a docker_host that is not a URL is refused, showing what is expected", async () => {
    const res = await declare({ name: "x", dockerHost: "192.168.1.20" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /ssh:\/\//);
  });

  it("a docker_host with the wrong scheme (http://) is refused", async () => {
    const res = await declare({ name: "x", dockerHost: "http://192.168.1.20:2375" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /http:/);
  });

  it("an ssh:// without a machine is refused: the costliest typo", async () => {
    const res = await declare({ name: "x", dockerHost: "ssh://" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /host name is missing/);
  });

  it("a non-http(s) callback address is refused", async () => {
    const res = await declare({ name: "x", callbackUrl: "ssh://100.64.0.1" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /http/);
  });

  it("an out-of-bounds cap is refused", async () => {
    assert.equal((await declare({ name: "x", maxConcurrentSessions: 60 })).status, 400);
    assert.equal((await declare({ name: "x", maxConcurrentSessions: 0 })).status, 400);
    assert.equal(db.select().from(schema.runners).all().length, 0);
  });
});
