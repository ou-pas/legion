// What v58 catches up: operator pauses recognised by the fixed French `body` that
// `pauseForOperator` wrote since 26/08. The risk of matching on text is switching an entry that is
// not a pause, so five cases sit side by side: the pause, an ordinary question, a question that
// mentions the pause phrase, and two reasons v57 already set.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-v58-"));
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
const { runMigrations } = await import("./index.js");

const ALL = [...s1, ...s11, ...s21, ...s31, ...s41, ...s46, ...s51, ...s56];

/** The exact legacy French text `pauseForOperator` wrote, copied rather than imported on purpose:
 *  a migration is frozen in time and must not follow current code. New pauses carry their reason
 *  from creation. */
const PAUSE_BODY =
  "Mise en pause à ta demande. J'ai poussé ce que j'avais et je me suis arrêtée à la fin de mon tour. Réponds à cette entrée pour reprendre.";

/** A v57 database: `reason` exists, the pause catch-up has not run. */
function baseAt57(name: string): Database.Database {
  const sqlite = new Database(join(dir, name));
  for (const [version, apply] of ALL) if (version <= 57) apply(sqlite);
  assert.equal(
    sqlite.pragma("user_version", { simple: true }),
    57,
    "precondition: the database must be at v57",
  );
  return sqlite;
}

/** Minimal fixture for `inbox_messages` foreign keys. */
function fixtures(sqlite: Database.Database, now: number): void {
  sqlite.exec(`
INSERT INTO projects (id, name, slug, created_at) VALUES ('p', 'P', 'p', ${now});
INSERT INTO agents (id, project_id, name, role_prompt, created_at) VALUES ('a', 'p', 'a', 'r', ${now});
INSERT INTO tasks (id, project_id, name, status, board_order, created_at, updated_at)
  VALUES ('t', 'p', 'T', 'doing', 0, ${now}, ${now});
INSERT INTO runners (id, name, kind) VALUES ('r', 'runner', 'docker');
INSERT INTO sessions (id, task_id, agent_id, runner_id, model, status, callback_token, started_at)
  VALUES ('s', 't', 'a', 'r', 'haiku', 'waiting-inbox', 'tok', ${now});
`);
}

const insertEntry = (
  sqlite: Database.Database,
  id: string,
  body: string,
  reason: string,
  now: number,
): void => {
  sqlite
    .prepare(
      `INSERT INTO inbox_messages (id, session_id, task_id, agent_id, kind, body, status, reason, created_at)
     VALUES (?, 's', 't', 'a', 'text', ?, 'answered', ?, ?)`,
    )
    .run(id, body, reason, now);
};

const reasonOf = (sqlite: Database.Database, id: string): string =>
  (sqlite.prepare("SELECT reason FROM inbox_messages WHERE id = ?").get(id) as { reason: string })
    .reason;

describe("v58, operator pauses already stored", () => {
  it("switches pauses and leaves everything else", () => {
    const sqlite = baseAt57("pauses.db");
    const now = Date.now();
    fixtures(sqlite, now);

    insertEntry(sqlite, "pause", PAUSE_BODY, "question", now);
    insertEntry(sqlite, "question", "Which date format for the export?", "question", now);
    // The text-matching trap, kept in French on purpose: a question containing the pause phrase
    // without starting with it must not switch.
    insertEntry(
      sqlite,
      "parle",
      "Faut-il mettre en pause à ta demande les sessions du soir ?",
      "question",
      now,
    );
    // Two reasons v57 set: left alone, signature or not.
    insertEntry(sqlite, "diag", "Failure, diagnostic: exit 137", "diagnostic", now);
    insertEntry(sqlite, "quota", PAUSE_BODY, "quota-pause", now);

    runMigrations(sqlite);

    assert.equal(
      reasonOf(sqlite, "pause"),
      "operator-pause",
      "the requested pause, recognised by its signature",
    );
    assert.equal(reasonOf(sqlite, "question"), "question", "an ordinary question is untouched");
    assert.equal(
      reasonOf(sqlite, "parle"),
      "question",
      "a question mentioning the pause is not one",
    );
    assert.equal(reasonOf(sqlite, "diag"), "diagnostic", "an existing reason is left as is");
    assert.equal(reasonOf(sqlite, "quota"), "quota-pause", "even when the text matches");
    sqlite.close();
  });

  it("passes cleanly on a database without pauses", () => {
    const sqlite = baseAt57("empty.db");
    runMigrations(sqlite);
    assert.ok((sqlite.pragma("user_version", { simple: true }) as number) >= 58);
    sqlite.close();
  });
});
