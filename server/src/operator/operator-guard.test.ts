// The operator guard over HTTP (13/09): a caller without a session is refused on an ordinary
// route, both ways in work, and the exemptions are exactly the intended ones. One exemption too
// many does not show on reading.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-operator-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { operatorGuard } = await import("./operator-guard.js");
const { registerOperatorRoutes } = await import("./routes.js");
const { ensureOperatorToken, resetOperatorToken, OPERATOR_COOKIE } = await import("./operator.js");

let token = "";

/** Only what is under test: the guard, the session routes, and witness routes, ordinary and
 *  exempt. Mounting the whole app would tie these tests to forty unrelated domains. */
const app = new Hono();
app.use("*", operatorGuard);
registerOperatorRoutes(app);
app.get("/api/bootstrap", (c) => c.json({ ok: true }));
app.post("/internal/sessions/abc/events", (c) => c.json({ ok: true }));
app.post("/webhooks/github", (c) => c.json({ ok: true }));
app.get("/index.html", (c) => c.text("<html></html>"));

before(() => {
  ensureOperatorToken();
  token = resetOperatorToken();
});

const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });

describe("the operator guard refuses what has no session", () => {
  it("refuses an API route when nothing is presented", async () => {
    const res = await get("/api/bootstrap");
    assert.equal(res.status, 401);
    // The message says what to do, and nothing about the instance's state.
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /an operator session is required/);
    assert.doesNotMatch(body.error, /\d+ session/);
  });

  it("refuses a wrong token the same way as a missing one", async () => {
    const res = await get("/api/bootstrap", { authorization: "Bearer not-the-right-one" });
    assert.equal(res.status, 401);
  });

  it("refuses a cookie naming no session", async () => {
    const res = await get("/api/bootstrap", { cookie: `${OPERATOR_COOKIE}=invented` });
    assert.equal(res.status, 401);
  });
});

describe("the two ways in", () => {
  it("the token bearer passes: the path for tools", async () => {
    const res = await get("/api/bootstrap", { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
  });

  it("pasting the token opens a session, and its cookie passes", async () => {
    const login = await app.request("/api/operator/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(login.status, 201);

    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i, "the cookie must be httpOnly: an XSS must not read it");
    assert.match(setCookie, /SameSite=Lax/i);
    // No `Secure` while the request arrives in plain HTTP: the browser would stop sending it.
    assert.doesNotMatch(setCookie, /Secure/i);

    const id = /legion_operator=([^;]+)/.exec(setCookie)?.[1];
    assert.ok(id, "the response must set the session cookie");
    const res = await get("/api/bootstrap", { cookie: `${OPERATOR_COOKIE}=${id}` });
    assert.equal(res.status, 200);
  });

  it("a refused token is not told why", async () => {
    const res = await app.request("/api/operator/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong" }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "token refused");
  });

  it("closing the session invalidates its cookie", async () => {
    const login = await app.request("/api/operator/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const id = /legion_operator=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const out = await app.request("/api/operator/session", {
      method: "DELETE",
      headers: { cookie: `${OPERATOR_COOKIE}=${id}` },
    });
    assert.equal(out.status, 204);
    assert.equal((await get("/api/bootstrap", { cookie: `${OPERATOR_COOKIE}=${id}` })).status, 401);
  });
});

describe("the exemptions, and nothing more", () => {
  it("lets the container channel through: it has its own per-session token", async () => {
    const res = await app.request("/internal/sessions/abc/events", { method: "POST" });
    assert.equal(res.status, 200);
  });

  it("lets webhooks through: they carry their signature", async () => {
    const res = await app.request("/webhooks/github", { method: "POST" });
    assert.equal(res.status, 200);
  });

  it("lets the UI load: it carries the login screen", async () => {
    assert.equal((await get("/index.html")).status, 200);
  });

  it("answers the session status without a session, or the UI could show nothing", async () => {
    const res = await get("/api/operator/session");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { authenticated: false, method: null });
  });
});
