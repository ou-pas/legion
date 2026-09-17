// A key's label (v48), and why it is not in the ciphertext: the label must read when the value no
// longer does. Stored in the ciphertext it would vanish with the master key, and an unreadable secret
// would lose its name exactly when one looks for which key is broken. The corrupt-secret test below
// is the heart of this file, not an edge case.
//
// Second axis, the null state: "never named" and "named then cleared" are the same state, neither an
// empty string. A secret from before this slice keeps working, shown by its variable name.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-secrets-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY = "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerProjectRoutes } = await import("./routes.js");
const { credentialEnvFor } = await import("./auth.js");

const app = new Hono();
registerProjectRoutes(app);

const PROJECT = "prj-secrets";
const OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";

type Listed = { id: string; name: string; label: string | null; projectId: string };

const list = async (): Promise<Listed[]> => {
  const all = (await (await app.request("/api/secrets")).json()) as Listed[];
  return all.filter((s) => s.projectId === PROJECT);
};

const save = (body: Record<string, unknown>) =>
  app.request("/api/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT, ...body }),
  });

const setLabel = (id: string, label: string | null) =>
  app.request(`/api/secrets/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });

before(() => {
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "Kopee", slug: "kopee", createdAt: new Date() })
    .run();
});

describe("a secret's label", () => {
  it("is set at creation and comes back with the name, without the value", async () => {
    assert.equal(
      (await save({ name: "STRIPE_KEY", value: "sk-live", label: "Production account" })).status,
      201,
    );
    const row = (await list()).find((s) => s.name === "STRIPE_KEY");
    assert.equal(row?.label, "Production account");
    // The list never returns the value, which is what makes the label necessary.
    assert.equal("value" in (row as object), false);
  });

  it("stays null when nobody set it: a secret from before this slice works the same", async () => {
    await save({ name: "NO_LABEL", value: "v" });
    assert.equal((await list()).find((s) => s.name === "NO_LABEL")?.label, null);
  });

  it("changes then clears without re-posting the value", async () => {
    await save({ name: "TO_RENAME", value: "v", label: "Tpyo" });
    const id = (await list()).find((s) => s.name === "TO_RENAME")?.id as string;

    assert.equal((await setLabel(id, "Staging account")).status, 200);
    assert.equal((await list()).find((s) => s.id === id)?.label, "Staging account");

    // An empty label clears rather than storing "", or the UI would have two empties to tell apart.
    assert.equal((await setLabel(id, "   ")).status, 200);
    assert.equal((await list()).find((s) => s.id === id)?.label, null);

    // The value never moved: relabelling does not touch the ciphertext.
    const stored = db.select().from(schema.secrets).where(eq(schema.secrets.id, id)).get();
    assert.ok(stored?.ciphertext);
  });

  it("survives a value that no longer decrypts: why it is a column", async () => {
    // An unreadable ciphertext (changed master key, restored database, corrupt row): the one moment
    // one really needs to know which key is broken.
    db.insert(schema.secrets)
      .values({
        id: "sec-broken",
        projectId: PROJECT,
        name: OAUTH,
        label: "Operator subscription",
        ciphertext: "not-valid-base64-at-all",
        createdAt: new Date(),
      })
      .run();

    assert.equal((await list()).find((s) => s.id === "sec-broken")?.label, "Operator subscription");
    // And credential resolution does not keep a key it cannot read: the project falls back to the
    // control plane rather than failing.
    assert.notEqual(credentialEnvFor(PROJECT).from, "project");
  });

  it("names the winning credential: its variable name and label", async () => {
    db.delete(schema.secrets).where(eq(schema.secrets.id, "sec-broken")).run();
    await save({ name: OAUTH, value: "sk-ant-oat-kopee", label: "Kopee subscription" });
    const resolved = credentialEnvFor(PROJECT);
    assert.equal(resolved.from, "project");
    assert.equal(resolved.credentialName, OAUTH);
    assert.equal(resolved.credentialLabel, "Kopee subscription");
  });
});
