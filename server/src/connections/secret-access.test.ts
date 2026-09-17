// The single choke point to a secret's value. Renewal is not implemented, so `freshSecret` is a plain
// traversal returning what the three resolutions it replaced returned; that equivalence is what made
// migrating them safe.
//
// The "renewal is ignored" test is deliberate and must fail once renewal lands here: it says nothing
// renews yet, not that nothing ever will.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-secret-access-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_MASTER_KEY = "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { encryptSecret } = await import("../shared/crypto.js");
const { freshAuthorization, freshSecret } = await import("./secret-access.js");
const { AUTH_FORMAT } = await import("./providers.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "one", slug: "one", createdAt: now }).run();
db.insert(schema.secrets)
  .values({
    id: "s1",
    projectId: "p1",
    name: "GITHUB_TOKEN",
    ciphertext: encryptSecret("ghp_value"),
    createdAt: now,
  })
  .run();
db.insert(schema.secrets)
  .values({
    id: "s2",
    projectId: "p1",
    name: "GITLAB_TOKEN",
    ciphertext: encryptSecret("glpat_value"),
    refreshCiphertext: encryptSecret("the-refresh-token"),
    metadata: JSON.stringify({ expiresAt: 0, account: "romuald" }),
    createdAt: now,
  })
  .run();
// Both rows of the 15/09 bug, read side: a Linear personal key accepted by the probe in raw format,
// and an OAuth token obtained through a flow. They differ only by what `metadata` retained.
db.insert(schema.secrets)
  .values({
    id: "s3",
    projectId: "p1",
    name: "LINEAR_TOKEN",
    ciphertext: encryptSecret("lin_api_pasted"),
    metadata: JSON.stringify({ authFormat: AUTH_FORMAT.raw }),
    createdAt: now,
  })
  .run();
db.insert(schema.projects).values({ id: "p3", name: "three", slug: "three", createdAt: now }).run();
db.insert(schema.secrets)
  .values({
    id: "s4",
    projectId: "p3",
    name: "LINEAR_TOKEN",
    ciphertext: encryptSecret("lin_oauth"),
    metadata: JSON.stringify({ authFormat: AUTH_FORMAT.bearer }),
    createdAt: now,
  })
  .run();

describe("freshSecret", () => {
  it("returns the decrypted value of a stored secret", () => {
    assert.equal(freshSecret("p1", "GITHUB_TOKEN"), "ghp_value");
  });

  it("returns null when the secret does not exist", () => {
    assert.equal(freshSecret("p1", "ABSENT"), null);
  });

  it("returns null when the project is not the secret's", () => {
    assert.equal(freshSecret("p2", "GITHUB_TOKEN"), null);
  });

  it("ignores renewal: plain traversal, nothing renews yet", () => {
    assert.equal(freshSecret("p1", "GITLAB_TOKEN"), "glpat_value");
  });
});

// The format is read back, not assumed. The other half of the 15/09 bug: the probe accepted a Linear
// personal key in raw format and the reader then sent it as `Bearer` (connected on screen, dead in
// use). These assertions fail if the prefix becomes a call-site decision again.
describe("freshAuthorization", () => {
  it("presents raw what the probe observed raw", () => {
    assert.equal(freshAuthorization("p1", "LINEAR_TOKEN"), "lin_api_pasted");
  });

  it("presents as Bearer what the probe observed as Bearer", () => {
    assert.equal(freshAuthorization("p3", "LINEAR_TOKEN"), "Bearer lin_oauth");
  });

  it("without an observed format it is Bearer, the format of every granted token", () => {
    assert.equal(freshAuthorization("p1", "GITHUB_TOKEN"), "Bearer ghp_value");
  });

  it("returns null when the secret does not exist, like freshSecret", () => {
    assert.equal(freshAuthorization("p1", "ABSENT"), null);
  });
});
