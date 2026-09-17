// v74 adds renewal next to the ciphertext and nothing else: NULL on existing rows (a pasted secret
// is not renewable), `ciphertext` untouched.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v74-"));
process.env.LEGION_DB = join(dir, "unused.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { steps: s1 } = await import("./v1-v10.js");
const { steps: s11 } = await import("./v11-v20.js");
const { steps: s21 } = await import("./v21-v30.js");
const { steps: s31 } = await import("./v31-v40.js");
const { steps: s41 } = await import("./v41-v45.js");
const { steps: s46 } = await import("./v46-v50.js");
const { steps: s51 } = await import("./v51-v55.js");
const { steps: s56 } = await import("./v56-v60.js");
const { steps: s61 } = await import("./v61-v65.js");
const { steps: s66 } = await import("./v66-v70.js");
const { steps: s71 } = await import("./v71-v75.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56, ...s61, ...s66, ...s71];

/** Opens a fresh database and applies migrations up to `upTo`. */
function dbUpTo(name: string, upTo: number): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [version, apply] of ALL) if (version <= upTo) apply(sqlite);
  return sqlite;
}

describe("v74, a credential's two columns", () => {
  it("adds both columns, NULL on existing rows, ciphertext untouched", () => {
    const sqlite = dbUpTo("v74.db", 73);
    sqlite
      .prepare(
        "INSERT INTO projects (id, name, slug, created_at) VALUES ('p1', 'one', 'one', 1700000000000)",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO secrets (id, project_id, name, ciphertext, created_at) VALUES ('s1', 'p1', 'GITHUB_TOKEN', 'CIPHER', 1700000000000)",
      )
      .run();

    const v74 = ALL.find(([version]) => version === 74);
    assert.ok(v74, "migration v74 must exist");
    v74![1](sqlite);

    const row = sqlite
      .prepare("SELECT ciphertext, refresh_ciphertext, metadata FROM secrets WHERE id = 's1'")
      .get() as { ciphertext: string; refresh_ciphertext: string | null; metadata: string | null };
    assert.equal(row.refresh_ciphertext, null, "an existing secret has no renewal");
    assert.equal(row.metadata, null, "and nothing is known about it yet");
    assert.equal(row.ciphertext, "CIPHER", "the migration rewrites no value");
    assert.equal(sqlite.pragma("user_version", { simple: true }), 74);
  });

  it("makes `metadata` queryable in SQL, the reason it is plain", () => {
    const sqlite = dbUpTo("v74-json.db", 73);
    sqlite
      .prepare(
        "INSERT INTO projects (id, name, slug, created_at) VALUES ('p1', 'one', 'one', 1700000000000)",
      )
      .run();
    const v74 = ALL.find(([version]) => version === 74);
    v74![1](sqlite);
    sqlite
      .prepare(
        "INSERT INTO secrets (id, project_id, name, ciphertext, metadata, created_at) VALUES ('s1', 'p1', 'GITLAB_TOKEN', 'CIPHER', '{\"expiresAt\":1700000000000,\"account\":\"romuald\"}', 1700000000000)",
      )
      .run();

    // Encrypted `metadata` would make this query impossible without decrypting the whole table.
    const soon = sqlite
      .prepare("SELECT name FROM secrets WHERE json_extract(metadata, '$.expiresAt') < ?")
      .all(1800000000000) as { name: string }[];
    assert.deepEqual(
      soon.map((r) => r.name),
      ["GITLAB_TOKEN"],
    );
  });
});
