// What the first patch writes, and above all what it does not. SQL on a migrated database, no
// `connections` import (`shared/` is a leaf): the checks are row facts that
// `readCredentialMetadata` reads later.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-p1-"));
process.env.LEGION_DB = join(dir, "unused.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { p1SecretsVersConnexions } = await import("./p1-secrets-vers-connexions.js");
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

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56, ...s61, ...s66, ...s71];

const POSED_AT = 1_700_000_000_000;
let n = 0;

function freshDb(): Database.Database {
  const sqlite = new Database(join(dir, `p1-${++n}.db`));
  for (const [, apply] of ALL) apply(sqlite);
  sqlite
    .prepare("INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
    .run("p1", "one", "one", POSED_AT);
  return sqlite;
}

type SecretRow = {
  id: string;
  project_id: string;
  name: string;
  ciphertext: string;
  label: string | null;
  created_at: number;
  refresh_ciphertext: string | null;
  metadata: string | null;
};

function pose(
  sqlite: Database.Database,
  name: string,
  ciphertext: string,
  metadata: string | null = null,
  createdAt = POSED_AT,
  projectId = "p1",
): void {
  sqlite
    .prepare(
      `INSERT INTO secrets (id, project_id, name, ciphertext, label, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`s${++n}`, projectId, name, ciphertext, null, createdAt, metadata);
}

const rows = (sqlite: Database.Database, name: string): SecretRow[] =>
  sqlite
    .prepare("SELECT * FROM secrets WHERE name = ? ORDER BY created_at")
    .all(name) as SecretRow[];

const metaOf = (sqlite: Database.Database, name: string): Record<string, unknown> =>
  JSON.parse(rows(sqlite, name)[0]!.metadata ?? "null") as Record<string, unknown>;

const apply = (sqlite: Database.Database): void => p1SecretsVersConnexions.apply(sqlite);

describe("p1, what is known offline and nothing more", () => {
  it("writes provider and origin on a provider row without `metadata`", () => {
    const sqlite = freshDb();
    pose(sqlite, "GITHUB_TOKEN", "CHIFFRE");

    apply(sqlite);

    assert.deepEqual(metaOf(sqlite, "GITHUB_TOKEN"), { provider: "github", origin: "pasted" });
  });

  it("invents neither account nor scopes", () => {
    const sqlite = freshDb();
    pose(sqlite, "GITLAB_TOKEN", "CHIFFRE");

    apply(sqlite);

    const written = metaOf(sqlite, "GITLAB_TOKEN");
    // Finding them requires asking the provider (`make adopt-tokens`).
    assert.equal("account" in written, false, "no account was observed");
    assert.equal("scopes" in written, false, "no scope was observed");
    // No format either: absent means `bearer`, the row's value before the patch.
    assert.equal("authFormat" in written, false);
  });

  it("leaves a row that already has `metadata`", () => {
    const sqlite = freshDb();
    const already = JSON.stringify({ provider: "github", origin: "granted", account: "romuald" });
    pose(sqlite, "GITHUB_TOKEN", "CHIFFRE", already);

    apply(sqlite);

    assert.equal(rows(sqlite, "GITHUB_TOKEN")[0]!.metadata, already);
  });

  it("leaves unreadable `metadata` alone: someone wrote it, even broken", () => {
    const sqlite = freshDb();
    pose(sqlite, "GITHUB_TOKEN", "CHIFFRE", "{this is not JSON");

    apply(sqlite);

    assert.equal(rows(sqlite, "GITHUB_TOKEN")[0]!.metadata, "{this is not JSON");
  });

  it("ignores a name no known provider uses", () => {
    const sqlite = freshDb();
    pose(sqlite, "SLACK_TOKEN", "CHIFFRE");

    apply(sqlite);

    assert.equal(rows(sqlite, "SLACK_TOKEN")[0]!.metadata, null);
  });
});

describe("p1, LINEAR_API_KEY, the only case moving a value", () => {
  it("copies the key under LINEAR_TOKEN, value and date intact", () => {
    const sqlite = freshDb();
    pose(sqlite, "LINEAR_API_KEY", "CLE_PERSONNELLE");

    apply(sqlite);

    const copied = rows(sqlite, "LINEAR_TOKEN");
    assert.equal(copied.length, 1);
    assert.equal(copied[0]!.ciphertext, "CLE_PERSONNELLE", "the value that worked");
    assert.equal(copied[0]!.created_at, POSED_AT, "the date of the operator's gesture");
    assert.equal(copied[0]!.project_id, "p1");
    assert.equal(
      copied[0]!.refresh_ciphertext,
      null,
      "a personal key cannot be renewed, and `renewable` must say so",
    );
  });

  it("the trap: the written `metadata` says the format is raw", () => {
    const sqlite = freshDb();
    pose(sqlite, "LINEAR_API_KEY", "CLE_PERSONNELLE");

    apply(sqlite);

    // Without it, absent means `bearer`: Linear would refuse `Bearer <personal key>` on every
    // request while the screen said "connected", the bug fixed on 15/09.
    assert.equal(metaOf(sqlite, "LINEAR_TOKEN").authFormat, "raw");
    assert.deepEqual(metaOf(sqlite, "LINEAR_TOKEN"), {
      provider: "linear",
      origin: "pasted",
      authFormat: "raw",
    });
  });

  it("deletes nothing: the old row stays, just unread", () => {
    const sqlite = freshDb();
    pose(sqlite, "LINEAR_API_KEY", "CLE_PERSONNELLE");

    apply(sqlite);

    const legacy = rows(sqlite, "LINEAR_API_KEY");
    assert.equal(legacy.length, 1, "no secret is destroyed");
    assert.equal(legacy[0]!.ciphertext, "CLE_PERSONNELLE");
  });

  it("never overwrites an existing LINEAR_TOKEN", () => {
    const sqlite = freshDb();
    pose(sqlite, "LINEAR_API_KEY", "VIEILLE_CLE");
    pose(sqlite, "LINEAR_TOKEN", "JETON_EN_SERVICE", JSON.stringify({ origin: "granted" }));

    apply(sqlite);

    const linear = rows(sqlite, "LINEAR_TOKEN");
    assert.equal(linear.length, 1, "no duplicate: resolution would pick one at random");
    assert.equal(
      linear[0]!.ciphertext,
      "JETON_EN_SERVICE",
      "replacing a token in service with an old key is the damage this must not do",
    );
  });

  it("copies only the most recent of a project's two keys", () => {
    const sqlite = freshDb();
    // (project, name) is not unique in the database: a real case.
    pose(sqlite, "LINEAR_API_KEY", "ANCIENNE", null, POSED_AT);
    pose(sqlite, "LINEAR_API_KEY", "RECENTE", null, POSED_AT + 1000);

    apply(sqlite);

    const copied = rows(sqlite, "LINEAR_TOKEN");
    assert.equal(copied.length, 1);
    assert.equal(copied[0]!.ciphertext, "RECENTE", "latest wins, as in `putSecret`");
  });

  it("copies into every concerned project and only those", () => {
    const sqlite = freshDb();
    sqlite
      .prepare("INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
      .run("p2", "two", "two", POSED_AT);
    sqlite
      .prepare("INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
      .run("p3", "three", "three", POSED_AT);
    pose(sqlite, "LINEAR_API_KEY", "CLE_P1", null, POSED_AT, "p1");
    pose(sqlite, "LINEAR_API_KEY", "CLE_P2", null, POSED_AT, "p2");

    apply(sqlite);

    assert.deepEqual(
      rows(sqlite, "LINEAR_TOKEN").map((r) => [r.project_id, r.ciphertext]),
      [
        ["p1", "CLE_P1"],
        ["p2", "CLE_P2"],
      ],
    );
  });
});

describe("p1, replayable", () => {
  it("changes nothing on a second pass", () => {
    const sqlite = freshDb();
    pose(sqlite, "GITHUB_TOKEN", "CHIFFRE_GH");
    pose(sqlite, "LINEAR_API_KEY", "CLE_PERSONNELLE");

    apply(sqlite);
    const after1 = sqlite.prepare("SELECT * FROM secrets ORDER BY id").all();
    apply(sqlite);
    const after2 = sqlite.prepare("SELECT * FROM secrets ORDER BY id").all();

    assert.deepEqual(after2, after1, "the first pass took every row out of its filter");
    assert.equal(rows(sqlite, "LINEAR_TOKEN").length, 1, "and added no second token");
  });
});
