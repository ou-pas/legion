// A project's chosen hue (v47), end to end: the route accepts it, refuses it, and returns to
// derivation when cleared.
//
// The property to keep: a project without a chosen hue keeps `hue = null`, so derivation from the
// name holds as before (slice nav/02). Hence three states the route must tell apart: set, cleared
// (`null`), and absent from the request (touches nothing). One `??` too many would merge them and
// the settings screen would clear the hue each time the name is saved.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-project-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerProjectRoutes } = await import("./routes.js");
const { PROJECT_HUES, validateHueInput } = await import("./hue.js");

const app = new Hono();
registerProjectRoutes(app);

const PROJECT = "prj-hue";

before(() => {
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "Kopee", slug: "kopee", createdAt: new Date() })
    .run();
});

const patch = (body: unknown) =>
  app.request(`/api/projects/${PROJECT}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const hueOf = () =>
  db.select().from(schema.projects).where(eq(schema.projects.id, PROJECT)).get()?.hue;

describe("validateHueInput", () => {
  it("accepts the twelve steps of the scale, and null to remove the choice", () => {
    for (let h = 0; h < PROJECT_HUES; h++)
      assert.deepEqual(validateHueInput(h), { ok: true, value: h });
    assert.deepEqual(validateHueInput(null), { ok: true, value: null });
  });

  it("refuses what would name no colour", () => {
    // `12` is the scale's trap: one step out of bounds, a square CSS cannot paint. `"3"` is the
    // form's: an input's value is a string.
    for (const bad of [12, -1, 1.5, "3", "", true, {}, [], NaN])
      assert.equal(validateHueInput(bad).ok, false, `should refuse ${JSON.stringify(bad)}`);
  });
});

describe("PATCH /api/projects/:id: hue", () => {
  it("a new project has no chosen hue: the derived one holds", () => {
    assert.equal(hueOf(), null);
  });

  it("a chosen hue replaces the derived one", async () => {
    assert.equal((await patch({ hue: 7 })).status, 200);
    assert.equal(hueOf(), 7);
  });

  it("an out-of-scale hue is refused with a message and does not overwrite the previous one", async () => {
    const res = await patch({ hue: 12 });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /between 0 and 11/);
    assert.equal(hueOf(), 7);
  });

  it("a request that does not mention the hue leaves it alone", async () => {
    // The case that would lose the colour unnoticed: the UI saves the context and the hue vanishes
    // because the route read `body.hue` as `null`.
    assert.equal((await patch({ context: "something else" })).status, 200);
    assert.equal(hueOf(), 7);
  });

  it("null removes the choice and returns to derivation", async () => {
    assert.equal((await patch({ hue: null })).status, 200);
    assert.equal(hueOf(), null);
  });
});

// One UPDATE (05/09). The route used to write field by field, so a field refused after one was
// written left the project half-modified. Everything is validated, then everything is written.
describe("PATCH /api/projects/:id: everything is validated before any field is written", () => {
  const row = () => db.select().from(schema.projects).where(eq(schema.projects.id, PROJECT)).get()!;

  it("a refused field writes no other field of the same body", async () => {
    const before = row();
    const res = await patch({ context: "a context that must not stay", hue: 12 });
    assert.equal(res.status, 400);
    assert.deepEqual(row(), before, "neither context nor hue moved");
  });

  it("rename, hue and context from one body land together", async () => {
    const res = await patch({ name: "Kopee 2", hue: 3, context: "ctx" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ok: true,
      name: "Kopee 2",
      slug: "kopee-2",
      slugMoved: true,
      slugReason: null,
    });
    assert.equal(row().name, "Kopee 2");
    assert.equal(row().slug, "kopee-2");
    assert.equal(row().hue, 3);
    assert.equal(row().context, "ctx");
  });

  it("git identity: empty string restores the default, invalid text refuses without writing", async () => {
    assert.equal(
      (await patch({ gitAuthorName: "Kopee Bot", gitAuthorEmail: "bot@kopee.dev" })).status,
      200,
    );
    assert.equal(row().gitAuthorName, "Kopee Bot");
    const res = await patch({ gitAuthorName: "", gitAuthorEmail: "not an address" });
    assert.equal(res.status, 400);
    assert.equal(row().gitAuthorName, "Kopee Bot", "the name was not cleared by a refused body");
    assert.equal((await patch({ gitAuthorName: "" })).status, 200);
    assert.equal(row().gitAuthorName, null);
  });

  it("a body with no known field touches nothing and answers 200", async () => {
    const before = row();
    assert.equal((await patch({})).status, 200);
    assert.deepEqual(row(), before);
  });
});

// The body is checked, not just declared (06/09, audit wave 2). `c.req.json<{…}>()` read nothing:
// the generic was a disguised `as`, and an invented key went through silently, so a setting believed
// saved was not.
describe("PATCH /api/projects/:id: what the body may not carry", () => {
  it("names the unknown key rather than silently dropping it", async () => {
    const res = await patch({ contxt: "missing an e" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /contxt/);
  });

  it("refuses a wrong type without ever writing it", async () => {
    const before = hueOf();
    const res = await patch({ defaultSkillNames: "impeccable" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /defaultSkillNames/);
    assert.equal(hueOf(), before);
  });
});

// The default model (batch nav/2a): named as fallback in the three routing selectors with no field
// to set it. The column is `NOT NULL`; empty, it would leave `resolveModel` with no fallback.
describe("PATCH /api/projects/:id: defaultModel", () => {
  const modelOf = () =>
    db.select().from(schema.projects).where(eq(schema.projects.id, PROJECT)).get()?.defaultModel;

  it("an id replaces the default", async () => {
    assert.equal((await patch({ defaultModel: "claude-opus-5" })).status, 200);
    assert.equal(modelOf(), "claude-opus-5");
  });

  it("an empty string is refused and does not clear the default", async () => {
    const res = await patch({ defaultModel: "  " });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /defaultModel/);
    assert.equal(modelOf(), "claude-opus-5");
  });

  it("a request that does not mention the model leaves it alone", async () => {
    assert.equal((await patch({ context: "something else" })).status, 200);
    assert.equal(modelOf(), "claude-opus-5");
  });
});

// The output folder, set after creation (13/09). It says where artifacts go and detaches that folder
// from the identifier; without it a project whose folder holds files refuses forever to move its slug.
describe("PATCH /api/projects/:id: the output folder", () => {
  const row = () => db.select().from(schema.projects).where(eq(schema.projects.id, PROJECT)).get()!;

  it("a relative path is refused and writes nothing", async () => {
    const res = await patch({ fsRoot: "some/where" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /absolute path/);
    assert.equal(row().fsRoot, null);
  });

  it("an absolute path is set, the empty string returns to the managed folder", async () => {
    assert.equal((await patch({ fsRoot: "  /elsewhere/output  " })).status, 200);
    assert.equal(row().fsRoot, "/elsewhere/output");
    assert.equal((await patch({ fsRoot: "" })).status, 200);
    assert.equal(row().fsRoot, null);
  });

  it("a non-empty folder freezes the identifier, and setting it explicitly frees it", async () => {
    // The project's managed folder, the one `rename.ts` looks at. One file is enough: it refuses to
    // orphan files, it does not count database rows.
    const managed = join(dir, "fs", row().slug);
    mkdirSync(managed, { recursive: true });
    writeFileSync(join(managed, "artifact.md"), "dropped by a session");

    const gele = await patch({ name: "Kopee Three" });
    assert.equal(gele.status, 200);
    const avant = (await gele.json()) as { slugMoved: boolean; slugReason: string };
    assert.equal(avant.slugMoved, false);
    assert.match(avant.slugReason, /is not empty/);

    // Same body: setting the root and renaming at once must suffice, or call order would be an
    // unwritten rule.
    const libre = await patch({ fsRoot: managed, name: "Kopee Four" });
    assert.equal(libre.status, 200);
    assert.deepEqual(await libre.json(), {
      ok: true,
      name: "Kopee Four",
      slug: "kopee-four",
      slugMoved: true,
      slugReason: null,
    });
    assert.equal(row().slug, "kopee-four", "the identifier followed");
    assert.equal(row().fsRoot, managed, "and the folder stayed where the files are");
  });
});
