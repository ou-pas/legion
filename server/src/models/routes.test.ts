// The model probe over HTTP (06/09). The domain's only mutating route had no wiring test, and its
// body was an unchecked `as` over network input. What is checked here is the refusal, not the
// verdict, which needs the SDK.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-models-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { mutationOriginGuard } = await import("../http/guard.js");
const { registerModelRoutes } = await import("./routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerModelRoutes(app);

const probe = (body?: unknown, headers: Record<string, string> = {}) =>
  app.request("/api/models/probe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

describe("POST /api/models/probe: what is refused before reaching the SDK", () => {
  it("an empty id is refused, naming the key", async () => {
    const res = await probe({ id: "   " });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /id/);
  });

  it("a missing id: same refusal, and a missing body is no longer tolerated", async () => {
    assert.equal((await probe({})).status, 400);
    assert.equal((await probe()).status, 400, "a missing body is an invalid body, not a `{}`");
  });

  it("a non-string id is refused, no longer silently ignored", async () => {
    const res = await probe({ id: 42 });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /id/);
  });

  it("an invented key is refused BY NAME", async () => {
    const res = await probe({ id: "claude-opus-4", agentId: "a1" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /agentId/);
  });

  it("a probe from another origin is stopped by the middleware, not by the route", async () => {
    assert.equal(
      (await probe({ id: "claude-opus-4" }, { origin: "https://evil.example" })).status,
      403,
    );
  });
});
