// Queries shared by the forge adapters. The empty list is what is checked: `repoRowsNamed` must query
// nothing and return zero rows, where `IN ()` on an empty list is a classic trap.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-integrations-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { repoRow, repoRowsNamed, repoRowsOf, secretCiphertextOf, setRepoWebhook } =
  await import("./integrations-store.js");

const now = new Date();
const projects: [string, string][] = [
  ["p1", "one"],
  ["p2", "two"],
];
for (const [id, slug] of projects)
  db.insert(schema.projects).values({ id, name: id, slug, createdAt: now }).run();
db.insert(schema.repos)
  .values({
    id: "r1",
    projectId: "p1",
    name: "legion",
    url: "https://github.com/o/r",
    createdAt: now,
  })
  .run();
db.insert(schema.repos)
  .values({
    id: "r2",
    projectId: "p1",
    name: "other",
    url: "https://github.com/o/a",
    createdAt: now,
  })
  .run();
db.insert(schema.repos)
  .values({
    id: "r3",
    projectId: "p2",
    name: "elsewhere",
    url: "https://github.com/o/x",
    createdAt: now,
  })
  .run();
db.insert(schema.secrets)
  .values({
    id: "s1",
    projectId: "p1",
    name: "GITHUB_TOKEN",
    ciphertext: "encrypted",
    createdAt: now,
  })
  .run();

describe("integrations-store", () => {
  it("a project's repositories do not spill into another's", () => {
    assert.deepEqual(
      repoRowsOf("p1")
        .map((r) => r.name)
        .sort(),
      ["legion", "other"],
    );
    assert.deepEqual(
      repoRowsOf("p2").map((r) => r.name),
      ["elsewhere"],
    );
  });

  it("an empty name list returns zero rows, without querying", () => {
    assert.deepEqual(repoRowsNamed("p1", []), []);
  });

  it("filters by name, and another project's name does not come back", () => {
    assert.deepEqual(
      repoRowsNamed("p1", ["legion", "elsewhere"]).map((r) => r.name),
      ["legion"],
    );
  });

  it("finds a repository by id", () => {
    assert.equal(repoRow("r1")?.name, "legion");
    assert.equal(repoRow("unknown"), undefined);
  });

  it("returns the secret still encrypted: decrypting is the caller's rule", () => {
    assert.equal(secretCiphertextOf("p1", "GITHUB_TOKEN"), "encrypted");
    assert.equal(secretCiphertextOf("p1", "GITLAB_TOKEN"), null);
    assert.equal(secretCiphertextOf("p2", "GITHUB_TOKEN"), null);
  });

  it("records the webhook on the repository", () => {
    setRepoWebhook("r1", "42", "https://example.test/webhooks/github");
    assert.equal(repoRow("r1")?.webhookId, "42");
    assert.equal(repoRow("r1")?.webhookUrl, "https://example.test/webhooks/github");
  });
});
