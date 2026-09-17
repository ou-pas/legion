// A crate never carries what renews a token.
//
// It already carries a project's secret values, knowingly: those tokens expire. A refresh token is
// renewable indefinitely, and the encrypted file can live for years on a USB stick.
//
// The exclusion follows from the code's shape (`crate-collect.ts` lists `{ name, value }` field by
// field). This test makes it intentional: replacing those fields with `...s` must fail here.
//
// `metadata` is not a secret (column invariant), so nothing forbids exporting it someday. Only the
// refresh token is locked.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-crate-metadata-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { encryptSecret } = await import("../shared/crypto.js");
const { collectCrate, DEFAULT_INCLUDE } = await import("./crate-collect.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "one", slug: "one", createdAt: now }).run();
db.insert(schema.secrets)
  .values({
    id: "s1",
    projectId: "p1",
    name: "GITLAB_TOKEN",
    ciphertext: encryptSecret("glpat_value"),
    refreshCiphertext: encryptSecret("RENEWABLE_SECRET"),
    metadata: JSON.stringify({ expiresAt: 0, account: "romuald" }),
    createdAt: now,
  })
  .run();

describe("crate: renewal stays home", () => {
  it("carries the secret value but no refresh token", () => {
    const crate = collectCrate("p1", { ...DEFAULT_INCLUDE, secrets: true });
    const secret = crate.secrets.find((s) => s.name === "GITLAB_TOKEN");
    assert.ok(secret, "the secret itself goes into the crate");
    assert.equal(secret.value, "glpat_value");
    assert.equal("refreshCiphertext" in secret, false);
    assert.equal(
      JSON.stringify(crate).includes("RENEWABLE_SECRET"),
      false,
      "the refresh token appears nowhere in the crate, not even encrypted",
    );
  });
});
