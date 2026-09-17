// CSRF protection only (rewritten 13/09). The operator token says who may act; the origin guard
// says whether a page may act on their behalf. A cookie is sent on its own, so a hostile page open
// in the operator's browser could drive the API without knowing any secret.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-guard-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { allowedOrigin, crossOriginBlocked, mutationOriginGuard } = await import("./guard.js");

describe("allowedOrigin: same origin, nothing else", () => {
  it("accepts the page served by this instance", () => {
    assert.equal(allowedOrigin("http://localhost:5173", "localhost:5173"), true);
    assert.equal(allowedOrigin("http://10.0.0.7:8790", "10.0.0.7:8790"), true);
    assert.equal(allowedOrigin("https://legion.example.test", "legion.example.test"), true);
  });

  it("refuses a page from the web, which is the whole point of the guard", () => {
    assert.equal(allowedOrigin("https://evil.example", "legion.example.test"), false);
  });

  it("refuses a different port: another service on the same machine is not us", () => {
    assert.equal(allowedOrigin("http://localhost:6006", "localhost:5173"), false);
  });

  it("refuses a sibling subdomain: another service on the same domain is not us", () => {
    assert.equal(allowedOrigin("https://other.example.test", "legion.example.test"), false);
  });

  it("refuses what is not an http(s) origin", () => {
    assert.equal(allowedOrigin("file:///etc/passwd", "localhost:5173"), false);
    assert.equal(allowedOrigin("null", "localhost:5173"), false);
    assert.equal(allowedOrigin("not a url", "localhost:5173"), false);
  });

  it("refuses when the request has no `Host`: nothing to compare against", () => {
    assert.equal(allowedOrigin("http://localhost:5173", undefined), false);
  });
});

describe("crossOriginBlocked", () => {
  const req = (headers: Record<string, string>) => ({
    req: { header: (n: string) => headers[n.toLowerCase()] },
  });

  it("does NOT block a missing origin: that is `curl`, a tool, a script", () => {
    assert.equal(crossOriginBlocked(req({ host: "localhost:8790" })), false);
  });

  it("does not block the application's page", () => {
    assert.equal(
      crossOriginBlocked(req({ origin: "http://localhost:5173", host: "localhost:5173" })),
      false,
    );
  });

  it("blocks a foreign origin", () => {
    assert.equal(
      crossOriginBlocked(req({ origin: "https://evil.example", host: "localhost:5173" })),
      true,
    );
  });
});

describe("mutationOriginGuard", () => {
  const app = new Hono();
  app.use("*", mutationOriginGuard);
  app.all("/api/agents", (c) => c.json({ ok: true }));
  app.post("/internal/sessions/abc/events", (c) => c.json({ ok: true }));
  app.post("/webhooks/github", (c) => c.json({ ok: true }));
  // Neighbour of the reserved prefix, declared BEFORE the first request: Hono freezes its router on
  // the first call, and a later route throws "matcher is already built".
  app.post("/webhooksfoo", (c) => c.json({ ok: true }));

  const call = (method: string, path: string, origin?: string) =>
    app.request(path, {
      method,
      headers: { host: "legion.test", ...(origin ? { origin } : {}) },
    });

  it("covers the FOUR mutating verbs, not only POST", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await call(method, "/api/agents", "https://evil.example");
      assert.equal(res.status, 403, `${method} must be refused`);
    }
  });

  it("lets a read through, even from elsewhere: CORS handles it in the browser", async () => {
    assert.equal((await call("GET", "/api/agents", "https://evil.example")).status, 200);
  });

  it("lets the application's own mutation through", async () => {
    assert.equal((await call("POST", "/api/agents", "https://legion.test")).status, 200);
  });

  it("leaves the container channel alone: a forge and an agent have no origin", async () => {
    assert.equal(
      (await call("POST", "/internal/sessions/abc/events", "https://evil.example")).status,
      200,
    );
    assert.equal((await call("POST", "/webhooks/github", "https://evil.example")).status, 200);
  });

  it("reserves ONLY these two prefixes, not `/webhooksfoo`", async () => {
    assert.equal((await call("POST", "/webhooksfoo", "https://evil.example")).status, 403);
  });
});
