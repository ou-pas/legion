// v75 creates `patches` and nothing else: two columns and no third (the migration's documented
// absences are schema facts), `id` as primary key, existing data untouched.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v75-"));
process.env.LEGION_DB = join(dir, "unused.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
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

describe("v75, the data patches table", () => {
  it("creates `patches` without touching existing data", () => {
    const sqlite = dbUpTo("v75.db", 74);
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

    const v75 = ALL.find(([version]) => version === 75);
    assert.ok(v75, "migration v75 must exist");
    v75![1](sqlite);

    assert.equal(sqlite.pragma("user_version", { simple: true }), 75);
    assert.deepEqual(sqlite.prepare("SELECT id, ran_at FROM patches").all(), []);
    const row = sqlite.prepare("SELECT ciphertext FROM secrets WHERE id = 's1'").get() as {
      ciphertext: string;
    };
    assert.equal(row.ciphertext, "CIPHER", "creating the patches table patches nothing");
  });

  it("has only `id` and `ran_at`", () => {
    const sqlite = dbUpTo("v75-shape.db", 75);

    const columns = (
      sqlite.prepare("PRAGMA table_info(patches)").all() as { name: string; notnull: number }[]
    ).map((c) => c.name);

    // No batch number (useless without `down`), no failure column (a failed patch is just unmarked).
    assert.deepEqual(columns, ["id", "ran_at"]);
  });

  it("makes `id` a primary key: a patch is recorded once", () => {
    const sqlite = dbUpTo("v75-pk.db", 75);
    sqlite.prepare("INSERT INTO patches (id, ran_at) VALUES ('p1', 1)").run();

    assert.throws(
      () => sqlite.prepare("INSERT INTO patches (id, ran_at) VALUES ('p1', 2)").run(),
      /UNIQUE/,
      "without uniqueness, a duplicate mark would suggest a patch ran twice",
    );
  });
});
