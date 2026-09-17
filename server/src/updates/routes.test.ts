// The update routes over HTTP (06/09). The route injects nothing and calls `startUpdate()` bare, so
// this only checks that a refusal arrives named with its status, not as an anonymous 500. On a repo
// with nothing newer, `startUpdate` refuses immediately: no `git fetch`, no container.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-updates-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { mutationOriginGuard } = await import("../http/guard.js");
const { registerUpdateRoutes } = await import("./routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerUpdateRoutes(app);

describe("the running version", () => {
  it("reads without writing anything, and returns JSON", async () => {
    const res = await app.request("/api/version");
    assert.equal(res.status, 200);
    assert.equal(typeof (await res.json()), "object");
  });
});

describe("starting the update", () => {
  it("a refusal arrives as 409 with its sentence, never a bare exception", async () => {
    const res = await app.request("/api/version/update", { method: "POST" });
    // 202 if the repo really had a target, 409 otherwise; what matters is no 500.
    assert.ok([202, 409].includes(res.status), `expected 202 or 409, got ${res.status}`);
    if (res.status === 409) assert.ok(((await res.json()) as { error: string }).error.length > 0);
  });

  it("the request from another origin is stopped by the middleware", async () => {
    const res = await app.request("/api/version/update", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(res.status, 403);
  });
});
