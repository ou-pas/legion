import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-credentials-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const {
  credentialRowById,
  credentialRowsOf,
  deleteCredentialRow,
  insertCredentialRow,
  projectRowExists,
  reorderCredentialRows,
  updateCredentialExhaustion,
  updateCredentialLabel,
} = await import("./store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();

describe("credentials-store", () => {
  it("projectRowExists tells a real project from an unknown id", () => {
    assert.equal(projectRowExists("p1"), true);
    assert.equal(projectRowExists("nope"), false);
  });

  it("inserts, reads by id and by project, in rank order", () => {
    insertCredentialRow({
      id: "c1",
      projectId: "p1",
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      rank: 2,
      ciphertext: "x",
      label: null,
      createdAt: now,
    });
    insertCredentialRow({
      id: "c2",
      projectId: "p1",
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      rank: 1,
      ciphertext: "y",
      label: "Pro",
      createdAt: now,
    });
    const rows = credentialRowsOf("p1");
    assert.deepEqual(
      rows.map((r) => r.id),
      ["c2", "c1"],
    );
    assert.equal(credentialRowById("c2")?.label, "Pro");
    assert.equal(credentialRowById("nope"), undefined);
  });

  it("updates exhaustion and label", () => {
    const until = new Date(now.getTime() + 1000);
    updateCredentialExhaustion("c1", "five_hour", until);
    assert.equal(credentialRowById("c1")?.exhaustedWindow, "five_hour");
    updateCredentialLabel("c1", "Personal");
    assert.equal(credentialRowById("c1")?.label, "Personal");
  });

  it("reorders with no gap or duplicate", () => {
    reorderCredentialRows("p1", ["c1", "c2"]);
    assert.equal(credentialRowById("c1")?.rank, 1);
    assert.equal(credentialRowById("c2")?.rank, 2);
  });

  it("deletes the row", () => {
    deleteCredentialRow("c2");
    assert.equal(credentialRowById("c2"), undefined);
    assert.equal(credentialRowsOf("p1").length, 1);
  });
});
