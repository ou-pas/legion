// `db.ts` wiring: patches run after migrations, and the boot logs it.
//
// Every other test imports `db.ts` and so runs `runPatches`, but on empty databases, which proves
// neither order nor trace. Here a database is built by hand up to v74 (before `patches`) with a row
// the first patch must process; the resulting `metadata` proves migrations ran first.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-patches-boot-"));
const DB = join(dir, "boot.db");
process.env.LEGION_DB = DB;
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

// Built before importing `db.ts`, which opens its file at load.
const { steps: s1 } = await import("../migrations/v1-v10.js");
const { steps: s11 } = await import("../migrations/v11-v20.js");
const { steps: s21 } = await import("../migrations/v21-v30.js");
const { steps: s31 } = await import("../migrations/v31-v40.js");
const { steps: s41 } = await import("../migrations/v41-v45.js");
const { steps: s46 } = await import("../migrations/v46-v50.js");
const { steps: s51 } = await import("../migrations/v51-v55.js");
const { steps: s56 } = await import("../migrations/v56-v60.js");
const { steps: s61 } = await import("../migrations/v61-v65.js");
const { steps: s66 } = await import("../migrations/v66-v70.js");
const { steps: s71 } = await import("../migrations/v71-v75.js");

const seed = new Database(DB);
for (const [version, apply] of [
  ...s1,
  ...s11,
  ...s21,
  ...s31,
  ...s41,
  ...s46,
  ...s51,
  ...s56,
  ...s61,
  ...s66,
  ...s71,
])
  if (version <= 74) apply(seed);
seed
  .prepare(
    "INSERT INTO projects (id, name, slug, created_at) VALUES ('p1', 'one', 'one', 1700000000000)",
  )
  .run();
seed
  .prepare(
    "INSERT INTO secrets (id, project_id, name, ciphertext, created_at) VALUES ('s1', 'p1', 'GITHUB_TOKEN', 'CIPHER', 1700000000000)",
  )
  .run();
seed.close();

const { listControlEvents } = await import("../db.js");

describe("boot wiring", () => {
  const sqlite = new Database(DB, { readonly: true });

  it("ran migrations then patches: the patch found the column and the table", () => {
    assert.equal(sqlite.pragma("user_version", { simple: true }), 75);
    assert.deepEqual(
      (sqlite.prepare("SELECT id FROM patches").all() as { id: string }[]).map((r) => r.id),
      ["p1-secrets-vers-connexions", "p2-seeded-text-in-english", "p3-legion-writes-in-english"],
    );
    const row = sqlite.prepare("SELECT metadata FROM secrets WHERE id = 's1'").get() as {
      metadata: string | null;
    };
    assert.deepEqual(JSON.parse(row.metadata ?? "null"), {
      provider: "github",
      origin: "pasted",
    });
  });

  it("logs both halves of the boot once each", () => {
    const messages = listControlEvents({ limit: 50 }).map((e) => e.message);

    assert.equal(
      messages.filter((m) => m.startsWith("migrations applied")).length,
      1,
      "one migration summary, not one per migration",
    );
    assert.deepEqual(
      messages.filter((m) => m.startsWith("data patches applied")),
      [
        "data patches applied: p1-secrets-vers-connexions, p2-seeded-text-in-english, p3-legion-writes-in-english",
      ],
      "one line per boot that ran something, not one per patch",
    );
  });
});
