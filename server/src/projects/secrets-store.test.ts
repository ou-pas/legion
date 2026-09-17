import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-secrets-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { deleteSecretRow, replaceSecret, secretRowById, secretRowsByName, updateSecretLabel } =
  await import("./secrets-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();

describe("secrets-store", () => {
  it("secretRowsByName is empty before insertion", () => {
    assert.equal(secretRowsByName("p1", "GITHUB_TOKEN").length, 0);
  });

  it("replaceSecret inserts the first value", () => {
    replaceSecret([], {
      id: "s1",
      projectId: "p1",
      name: "GITHUB_TOKEN",
      label: null,
      ciphertext: "c1",
      refreshCiphertext: null,
      metadata: null,
      createdAt: now,
    });
    assert.equal(secretRowsByName("p1", "GITHUB_TOKEN").length, 1);
  });

  it("replaceSecret deletes the old row and inserts the new one in the same transaction", () => {
    const previous = secretRowsByName("p1", "GITHUB_TOKEN").map((r) => r.id);
    replaceSecret(previous, {
      id: "s2",
      projectId: "p1",
      name: "GITHUB_TOKEN",
      label: "Perso",
      ciphertext: "c2",
      refreshCiphertext: null,
      metadata: null,
      createdAt: now,
    });
    const rows = secretRowsByName("p1", "GITHUB_TOKEN");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "s2");
    assert.equal(secretRowById("s1"), undefined);
  });

  it("updateSecretLabel and deleteSecretRow", () => {
    updateSecretLabel("s2", "Pro");
    assert.equal(secretRowById("s2")?.label, "Pro");
    deleteSecretRow("s2");
    assert.equal(secretRowById("s2"), undefined);
  });
});
