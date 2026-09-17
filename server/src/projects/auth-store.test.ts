import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-auth-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { credentialSecretRows } = await import("./auth-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.secrets)
  .values([
    { id: "s1", projectId: "p1", name: "ANTHROPIC_API_KEY", ciphertext: "c1", createdAt: now },
    { id: "s2", projectId: "p1", name: "GITHUB_TOKEN", ciphertext: "c2", createdAt: now },
  ])
  .run();

describe("credentialSecretRows", () => {
  it("returns only secrets whose name is requested", () => {
    const rows = credentialSecretRows("p1", ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "s1");
  });

  it("returns nothing for a project without a secret of that name", () => {
    assert.equal(credentialSecretRows("p1", ["CLAUDE_CODE_OAUTH_TOKEN"]).length, 0);
  });
});
