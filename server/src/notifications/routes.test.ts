// The domain's five mutating routes, seen through HTTP (06/09): the path exists, the verdict
// crosses Hono, and a malformed body is refused by the schema.
//
// The origin guard is mounted as middleware, not called per route: `mutationOriginGuard` is what
// protects production, so it is what must refuse here.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-notif-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerNotificationRoutes } = await import("./routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerNotificationRoutes(app);

const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

beforeEach(() => {
  db.delete(schema.webhooks).run();
});

describe("standup hour", () => {
  it("accepts an hour of the day and returns what was stored", async () => {
    const res = await post("/api/standup/hour", { hour: 9 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hour: 9 });
  });

  it("accepts `null` as a value, which turns the standup off", async () => {
    assert.equal((await post("/api/standup/hour", { hour: null })).status, 200);
    assert.deepEqual(await (await post("/api/standup/hour", { hour: null })).json(), {
      hour: null,
    });
  });

  it("refuses 24 naming the key, and the hour does not change", async () => {
    await post("/api/standup/hour", { hour: 7 });
    const res = await post("/api/standup/hour", { hour: 24 });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /hour/);
    assert.deepEqual(
      await (await app.request("/api/standup")).json().then((b) => (b as { hour: number }).hour),
      7,
    );
  });

  it("refuses an unknown key naming it, instead of dropping it silently", async () => {
    const res = await post("/api/standup/hour", { hour: 9, timezone: "Europe/Paris" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /timezone/);
  });

  it("sends now, and without a text channel files a notice", async () => {
    assert.equal((await post("/api/standup/send")).status, 200);
    assert.ok(
      db.select().from(schema.notices).all().length >= 1,
      "the standup lands in the in-app inbox",
    );
  });
});

describe("kill-switch and webhooks", () => {
  it("the toggle accepts a boolean and returns the stored state", async () => {
    assert.deepEqual(await (await post("/api/notifications/toggle", { enabled: false })).json(), {
      enabled: false,
    });
    assert.deepEqual(await (await post("/api/notifications/toggle", { enabled: true })).json(), {
      enabled: true,
    });
  });

  it('refuses the string "false" naming the key', async () => {
    const res = await post("/api/notifications/toggle", { enabled: "false" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /enabled/);
  });

  it("creates then deletes a webhook", async () => {
    const created = await post("/api/webhooks", { url: "https://example.test/hook", events: [] });
    assert.equal(created.status, 201);
    const { id } = (await created.json()) as { id: string };
    assert.equal(db.select().from(schema.webhooks).all().length, 1);

    assert.equal((await app.request(`/api/webhooks/${id}`, { method: "DELETE" })).status, 200);
    assert.equal(db.select().from(schema.webhooks).all().length, 0);
  });

  it("refuses a non-http(s) URL in `notify.ts`, with its sentence", async () => {
    const res = await post("/api/webhooks", { url: "ftp://example.test" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /http\(s\)/);
  });

  it("refuses an unknown event and lists the valid ones", async () => {
    const res = await post("/api/webhooks", { url: "https://example.test", events: ["whatever"] });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /whatever/);
    assert.equal(db.select().from(schema.webhooks).all().length, 0, "nothing was written");
  });

  it("stops a write from another origin in the middleware, not the route", async () => {
    const res = await post(
      "/api/webhooks",
      { url: "https://example.test" },
      { origin: "https://evil.example" },
    );
    assert.equal(res.status, 403);
  });
});
