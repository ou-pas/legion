// Error → status translation seen from outside (06/09). Through `app.request()`, not `knownFailure`:
// what is checked is the wiring (`app.onError` registered and reached) and that an unexpected
// exception's message does NOT leak. A unit test on the function would miss an unregistered handler.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { z } from "zod";

const dir = mkdtempSync(join(tmpdir(), "legion-http-errors-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { listControlEvents } = await import("../shared/db.js");
const { app } = await import("./app.js");
const { resetOperatorToken } = await import("../operator/operator.js");
const { BadRequestError, ConflictError, NotFoundError, HttpError } = await import("./errors.js");
const { CatalogError } = await import("../chains/catalog.js");
const { BlockedSessionError } = await import("../sessions/session-guard.js");
const { ChosenRunnerError, NoCapacityError, NoDiskError, NoReachableRunnerError } =
  await import("../sessions/runner/launch-errors.js");
const { TaskBlockedError } = await import("../tasks/blockers.js");

/** One route per exception, under `/api` so the SPA fallback cannot catch it. */
const raise = (path: string, make: () => Error) =>
  app.get(`/api/__errors/${path}`, () => {
    throw make();
  });

raise("http", () => new HttpError("paid in advance", 402));
raise("not-found", () => new NotFoundError("project not found"));
raise("conflict", () => new ConflictError("already installed"));
raise("bad-request", () => new BadRequestError("projectId required"));
raise("catalog", () => new CatalogError("chain not found", 404));
raise("blocked", () => new BlockedSessionError());
raise("capacity", () => new NoCapacityError("all machines are full"));
raise("unreachable", () => new NoReachableRunnerError("no machine answers"));
raise("disk", () => new NoDiskError("out of disk"));
raise("blocked-task", () => new TaskBlockedError('blocked by "remaining 2" (later)'));
raise("chosen-runner", () => new ChosenRunnerError("the chosen machine is disabled"));
raise("zod", () => {
  z.strictObject({ choices: z.array(z.strictObject({ id: z.string() })) }).parse({
    choices: [{ id: 7 }],
  });
  return new Error("unreachable");
});
app.get("/api/__errors/boom", () => {
  throw new Error("ENOENT: /Users/operator/.legion/master.key not found");
});

// The operator guard is mounted on the app (13/09): without a token these calls would get 401 and
// never reach the translation they check. Bearer is the tools' path, and a test is a tool.
const auth = { authorization: `Bearer ${resetOperatorToken()}` };

const status = async (path: string) =>
  (await app.request(`/api/__errors/${path}`, { headers: auth })).status;
const body = async (path: string) =>
  (await (await app.request(`/api/__errors/${path}`, { headers: auth })).json()) as {
    error: string;
    ref?: string;
  };

describe("a known exception returns its status", () => {
  it("`HttpError` and its three shortcuts carry their own", async () => {
    assert.equal(await status("http"), 402);
    assert.equal(await status("not-found"), 404);
    assert.equal(await status("conflict"), 409);
    assert.equal(await status("bad-request"), 400);
    assert.equal((await body("not-found")).error, "project not found");
  });

  it('`CatalogError` keeps its own: it tells "already installed" from "malformed"', async () => {
    assert.equal(await status("catalog"), 404);
  });

  it("a blocked session is a state CONFLICT, not a malformed request", async () => {
    assert.equal(await status("blocked"), 409);
  });

  it("the three launch refusals return 503: the fleet, not the request", async () => {
    assert.equal(await status("capacity"), 503);
    assert.equal(await status("unreachable"), 503);
    assert.equal(await status("disk"), 503);
    assert.match((await body("capacity")).error, /full/);
  });

  // 10/09, task `T6ywbnqS3Y`: five clicks, five "internal error", and the reason visible only in
  // the control plane log. A refusal the operator can lift must reach them, with its sentence.
  it("a blocked task and an unusable chosen machine return 409, with their reason", async () => {
    assert.equal(await status("blocked-task"), 409);
    assert.match((await body("blocked-task")).error, /blocked by/);
    assert.equal(await status("chosen-runner"), 409);
    assert.match((await body("chosen-runner")).error, /disabled/);
  });

  it("a `ZodError` returns 400 NAMING the faulty key's path", async () => {
    assert.equal(await status("zod"), 400);
    assert.match((await body("zod")).error, /choices\.0\.id/);
  });
});

describe("an unexpected exception does not leak", () => {
  it("returns 500, a reference, and NOTHING of the message: the detail stays in the log", async () => {
    const r = await app.request("/api/__errors/boom", { headers: auth });
    assert.equal(r.status, 500);
    const out = (await r.json()) as { error: string; ref: string };
    assert.equal(out.error, "internal error");
    assert.ok(out.ref, "a reference linking the toast to the log line");
    assert.doesNotMatch(JSON.stringify(out), /master\.key/, "the internal path does not leak");

    const logged = listControlEvents({ level: "error", limit: 20 }).find(
      (e) => e.source === "http" && e.message.includes("master.key"),
    );
    assert.ok(logged, "the event is logged with the real message");
    assert.equal(
      (logged.payload as { ref?: string } | null)?.ref,
      out.ref,
      "the reference links both",
    );
  });
});

describe("an unknown route", () => {
  it("returns JSON, not Hono's default text", async () => {
    const r = await app.request("/api/does-not-exist", { headers: auth });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: "unknown route" });
  });
});
