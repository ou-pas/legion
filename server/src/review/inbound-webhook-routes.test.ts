// The two screen routes for inbound webhooks (06/09). The public doorbell (`POST /webhooks/:forge`)
// is covered on the decision side by `merge-events.test.ts`; this file takes the other two, from
// the System settings screen, which had no test. `PATCH /api/inbound-webhooks` read its body with
// `c.req.json<{ baseUrl?: unknown }>()` and checked the type by hand; a schema replaced that.
//
// The `https` rule stays in the route on purpose: the forge will post a header secret there, so
// "http://" is not a shape error but a secret we would broadcast. The message says so; a type
// refusal would not.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-inbound-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerInboundWebhookRoutes } = await import("./inbound-webhook-routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerInboundWebhookRoutes(app);

const patch = (body: unknown, headers: Record<string, string> = {}) =>
  app.request("/api/inbound-webhooks", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

beforeEach(() => {
  db.delete(schema.settings).run();
});

describe("the funnel's public address", () => {
  it("an https URL is saved, and the response reads it back", async () => {
    const res = await patch({ baseUrl: "https://legion.example.ts.net/" });
    assert.equal(res.status, 200);
    const out = (await res.json()) as { baseUrl: string };
    assert.equal(out.baseUrl, "https://legion.example.ts.net", "the trailing / is trimmed");

    const state = (await (await app.request("/api/inbound-webhooks")).json()) as {
      baseUrl: string;
      secretReady: boolean;
    };
    assert.equal(state.baseUrl, "https://legion.example.ts.net");
    assert.equal(typeof state.secretReady, "boolean", "the secret's state, never its value");
  });

  it("an empty string clears the setting: a legitimate gesture", async () => {
    await patch({ baseUrl: "https://legion.example.ts.net" });
    assert.equal((await patch({ baseUrl: "" })).status, 200);
  });

  it("http:// is refused, saying what is expected: a secret does not travel in clear", async () => {
    const res = await patch({ baseUrl: "http://legion.example.ts.net" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /https/);
  });

  it("a missing `baseUrl` is refused, naming the key", async () => {
    const res = await patch({});
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /baseUrl/);
  });

  it("an invented key is refused by name, not silently dropped", async () => {
    const res = await patch({ baseUrl: "https://x.ts.net", secret: "i-pick-my-own" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /secret/);
  });

  it("a setting from another origin is stopped by the middleware", async () => {
    assert.equal(
      (await patch({ baseUrl: "https://x.ts.net" }, { origin: "https://evil.example" })).status,
      403,
    );
  });
});

describe("connecting a repository", () => {
  it("an unknown repository is refused, saying so, without touching the forge", async () => {
    const res = await app.request("/api/repos/ghost/webhook", { method: "POST" });
    assert.equal(res.status, 400);
    assert.ok((await errorOf(res)).length > 0);
  });
});
