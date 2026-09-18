// The setup status route, seen through HTTP (18/09): `required` flips the instant the first
// operator session opens, and never reveals anything beyond that boolean.
//
// `operator-guard.test.ts` already proves this path is reachable without a session; this file
// covers the business answer it gives, with its own fresh database so the count starts at zero.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-operator-setup-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { registerOperatorRoutes } = await import("./routes.js");
const { ensureOperatorToken, resetOperatorToken } = await import("./operator.js");

const app = new Hono();
registerOperatorRoutes(app);

describe("the setup status", () => {
  it("is required when no operator session has ever opened", async () => {
    const res = await app.request("/api/operator/setup");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { required: true });
  });

  it("is no longer required once one has, and carries no token", async () => {
    ensureOperatorToken();
    const token = resetOperatorToken();
    const login = await app.request("/api/operator/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    assert.equal(login.status, 201);

    const res = await app.request("/api/operator/setup");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { required: false });
    assert.deepEqual(Object.keys(body as object), ["required"]);
  });
});
