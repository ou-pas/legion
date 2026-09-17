// The three mutating crate routes over HTTP (06/09). The format tests never opened the port, yet
// that is where `String(body.x ?? "")` lived until audit wave 2 replaced it with a schema: a
// passphrase sent as a number silently became a string.
//
// The wrong-passphrase case checks the promise in the header of `routes.ts`: the passphrase appears
// in no message.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-crate-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY ??= "test-only-key-for-this-suite";
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { mutationOriginGuard } = await import("../http/guard.js");
const { registerPortabilityRoutes } = await import("./routes.js");

const app = new Hono();
app.use("*", mutationOriginGuard);
registerPortabilityRoutes(app);

const P1 = "p1";
const PASS = "a whole sentence that holds";
const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
const seal = () => post(`/api/projects/${P1}/crate`, { passphrase: PASS });

beforeEach(() => {
  const now = new Date();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: P1, name: "Project", slug: "project", createdAt: now })
    .run();
  db.insert(schema.agents)
    .values({ id: "a1", projectId: P1, name: "front", rolePrompt: "r", createdAt: now })
    .run();
});

describe("sealing a crate", () => {
  it("the happy path returns a file name and encrypted content", async () => {
    const res = await seal();
    assert.equal(res.status, 200);
    const out = (await res.json()) as { filename: string; content: string };
    assert.match(out.filename, /project/);
    assert.ok(out.content.length > 0);
    assert.doesNotMatch(out.content, /front/, "the content is encrypted, not clear JSON");
  });

  it("a too-short passphrase is refused, stating the minimum", async () => {
    const res = await post(`/api/projects/${P1}/crate`, { passphrase: "short" });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /characters/);
  });

  it("a number is not coerced into a passphrase: refused, naming the key", async () => {
    const res = await post(`/api/projects/${P1}/crate`, { passphrase: 12345678901234 });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /passphrase/);
  });

  it("an invented key is refused, not silently dropped", async () => {
    const res = await post(`/api/projects/${P1}/crate`, { passphrase: PASS, includeSecrets: true });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /includeSecrets/);
  });

  it("a missing project is 404, distinct from the 400 of bad input", async () => {
    assert.equal((await post("/api/projects/ghost/crate", { passphrase: PASS })).status, 404);
  });
});

describe("preview then import", () => {
  it("the full round trip: seal, preview, import", async () => {
    const { content } = (await (await seal()).json()) as { content: string };

    const preview = await post("/api/crate/preview", { content, passphrase: PASS });
    assert.equal(preview.status, 200);
    // The summary counts, it does not name: enough to confirm an import without revealing anything.
    const summary = (await preview.json()) as { counts: { agents: number } };
    assert.equal(summary.counts.agents, 1);

    const imported = await post("/api/crate/import", { content, passphrase: PASS, name: "Copy" });
    assert.equal(imported.status, 201);
    assert.equal(db.select().from(schema.projects).all().length, 2);
  });

  it("a wrong passphrase returns 400, and the message does not contain it", async () => {
    const { content } = (await (await seal()).json()) as { content: string };
    const res = await post("/api/crate/preview", {
      content,
      passphrase: "not the right one at all",
    });
    assert.equal(res.status, 400);
    const message = await errorOf(res);
    assert.doesNotMatch(
      message,
      /not the right one at all/,
      "the attempted passphrase does not come back in the response",
    );
  });

  it("an import without `content` is refused, naming the key, before any decryption", async () => {
    const res = await post("/api/crate/import", { passphrase: PASS });
    assert.equal(res.status, 400);
    assert.match(await errorOf(res), /content/);
    assert.equal(db.select().from(schema.projects).all().length, 1, "nothing was created");
  });

  it("an import from another origin is stopped by the middleware", async () => {
    const res = await post(
      "/api/crate/import",
      { content: "x", passphrase: PASS },
      { origin: "https://evil.example" },
    );
    assert.equal(res.status, 403);
  });
});
