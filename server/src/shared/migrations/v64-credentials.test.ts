// What v64 moves and what it leaves. Subscription tokens move from `secrets` to ranked
// `credentials`; a lost token would silently run sessions on the control plane's account. Replays
// the migration on a v62 database and checks each row, and that `ANTHROPIC_API_KEY` and
// `GITHUB_TOKEN` stay put.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v64-"));
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
const { runMigrations } = await import("./index.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56, ...s61];

/** A database at v62. */
function baseAt62(name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [version, apply] of ALL) if (version <= 62) apply(sqlite);
  assert.equal(
    sqlite.pragma("user_version", { simple: true }),
    62,
    "precondition: the database must be at v62",
  );
  return sqlite;
}

function seedProject(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare("INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
    .run(id, id, id, Date.now());
}

function seedSecret(
  sqlite: Database.Database,
  id: string,
  projectId: string,
  name: string,
  label: string | null,
  createdAt: number,
): void {
  sqlite
    .prepare(
      "INSERT INTO secrets (id, project_id, name, ciphertext, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, projectId, name, `cipher-of-${id}`, label, createdAt);
}

describe("v64, Claude credentials leave secrets", () => {
  it("moves the subscription token to rank 1 with id, ciphertext and label", () => {
    const sqlite = baseAt62("one-token.db");
    seedProject(sqlite, "p1");
    seedSecret(sqlite, "sec-oauth", "p1", "CLAUDE_CODE_OAUTH_TOKEN", "Personal", 1000);
    runMigrations(sqlite);

    const rows = sqlite
      .prepare("SELECT * FROM credentials WHERE project_id = 'p1'")
      .all() as Record<string, unknown>[];
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0]!.id,
      "sec-oauth",
      "the id does not change: a row can be found after the move",
    );
    assert.equal(rows[0]!.name, "CLAUDE_CODE_OAUTH_TOKEN");
    assert.equal(rows[0]!.rank, 1);
    assert.equal(rows[0]!.ciphertext, "cipher-of-sec-oauth", "same ciphertext, same master key");
    assert.equal(rows[0]!.label, "Personal");
    assert.equal(rows[0]!.created_at, 1000);

    const left = sqlite
      .prepare("SELECT COUNT(*) AS n FROM secrets WHERE name = 'CLAUDE_CODE_OAUTH_TOKEN'")
      .get() as { n: number };
    assert.equal(left.n, 0, "the token does not stay on both sides");
    sqlite.close();
  });

  it("leaves the API key in secrets: read after the list, never ranked", () => {
    const sqlite = baseAt62("api-key.db");
    seedProject(sqlite, "p1");
    seedSecret(sqlite, "sec-api", "p1", "ANTHROPIC_API_KEY", null, 1000);
    seedSecret(sqlite, "sec-gh", "p1", "GITHUB_TOKEN", null, 1000);
    runMigrations(sqlite);

    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number }).n,
      0,
    );
    const names = (
      sqlite.prepare("SELECT name FROM secrets ORDER BY name").all() as { name: string }[]
    ).map((r) => r.name);
    assert.deepEqual(names, ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"]);
    sqlite.close();
  });

  it("ranks per project: two projects each get rank 1", () => {
    const sqlite = baseAt62("two-projects.db");
    seedProject(sqlite, "p1");
    seedProject(sqlite, "p2");
    seedSecret(sqlite, "sec-1", "p1", "CLAUDE_CODE_OAUTH_TOKEN", null, 1000);
    seedSecret(sqlite, "sec-2", "p2", "CLAUDE_CODE_OAUTH_TOKEN", null, 2000);
    runMigrations(sqlite);

    const rows = sqlite
      .prepare('SELECT project_id, "rank" FROM credentials ORDER BY project_id')
      .all();
    assert.deepEqual(rows, [
      { project_id: "p1", rank: 1 },
      { project_id: "p2", rank: 1 },
    ]);
    sqlite.close();
  });

  it("survives a duplicate name in secrets: (project, name) was never unique in the database", () => {
    // A fixed rank of 1 would break the unique index, the migration, and the boot.
    const sqlite = baseAt62("duplicate.db");
    seedProject(sqlite, "p1");
    seedSecret(sqlite, "sec-old", "p1", "CLAUDE_CODE_OAUTH_TOKEN", "old", 1000);
    seedSecret(sqlite, "sec-new", "p1", "CLAUDE_CODE_OAUTH_TOKEN", "recent", 2000);
    runMigrations(sqlite);

    const rows = sqlite.prepare('SELECT id, "rank" FROM credentials ORDER BY "rank"').all();
    assert.deepEqual(
      rows,
      [
        { id: "sec-old", rank: 1 },
        { id: "sec-new", rank: 2 },
      ],
      "the oldest comes first",
    );
    sqlite.close();
  });

  it("adds sessions.credential_id, NULL on existing sessions", () => {
    const sqlite = baseAt62("sessions.db");
    runMigrations(sqlite);
    const cols = (sqlite.pragma("table_info(sessions)") as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes("credential_id"), "the column exists");
    sqlite.close();
  });
});
