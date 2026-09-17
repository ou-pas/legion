// Migrations v61 to v65. Array order is application order (see index.ts).
import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

export function v61(sqlite: Database.Database): void {
  // v61: the token guardrail changes unit, so its default follows (04/09). Counters became weighted
  // by billing ratio (an output token weighs 5x an input token), so the old 3 000 000 default (v27)
  // became much looser; 1 500 000 keeps the same tolerance in the new unit. The budget was removed
  // in v65; this step still runs in order on fresh databases.
  //
  // SQLite cannot change an existing column's DEFAULT without rebuilding the table, so projects
  // still on the old default are backfilled (as in v43); other values are the operator's choice.
  sqlite.exec(`
BEGIN;
UPDATE projects SET token_budget = 1500000 WHERE token_budget = 3000000;
PRAGMA user_version = 61;
COMMIT;
`);
}

export function v62(sqlite: Database.Database): void {
  // v62: a round's draft (07/09). Leaving the screen lost a half-filled form, so rounds were answered
  // fast rather than well.
  //
  // No new status: a `partial` next to `open` would burden every `status` reader with a distinction
  // that changes nothing for them. "Partially answered" is derived: open entry + non-empty draft.
  //
  // No link column between rounds: they share `task_id` and are ordered by `created_at`
  // (inbox/inbox-question.ts).
  //
  // Both columns and the version mark in one transaction: interrupted, the step would replay and
  // `ADD COLUMN draft` would fail.
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN draft TEXT;
ALTER TABLE inbox_messages ADD COLUMN draft_at INTEGER;
PRAGMA user_version = 62;
COMMIT;
`);
}

export function v63(sqlite: Database.Database): void {
  // v63: `Agent` for everyone (08/09, operator decision). Agents without `allowed_tools` get it from
  // DEFAULT_TOOLS; this catches up agents with an explicit list frozen at install.
  //
  // Fills a gap without overwriting (as v43, v61): appended at the end (`json_insert` on `$[#]`) only
  // if missing; `json_valid` guards hand-edited values.
  sqlite.exec(`
BEGIN;
UPDATE agents
   SET allowed_tools = json_insert(allowed_tools, '$[#]', 'Agent')
 WHERE allowed_tools IS NOT NULL
   AND json_valid(allowed_tools)
   AND NOT EXISTS (SELECT 1 FROM json_each(agents.allowed_tools) WHERE value = 'Agent');
PRAGMA user_version = 63;
COMMIT;
`);
}

export function v64(sqlite: Database.Database): void {
  // v64: Claude credentials leave `secrets` and get a rank (08/09). A project could hold one
  // subscription token (`putSecret` upserts by name), and a session out of quota slept even when
  // another account was available.
  //
  // `CLAUDE_CODE_OAUTH_TOKEN` rows move to `credentials` with id, ciphertext, label and date, then
  // leave `secrets`. Same encryption, same id: nothing is lost.
  //
  // `ANTHROPIC_API_KEY` stays a project secret, read after the list, never ranked.
  //
  // Rank via `ROW_NUMBER()`, not fixed at 1: `secrets` never enforced (project, name) uniqueness in
  // the database, and duplicates would break the unique index.
  //
  // Exhaustion is two columns, not a table (reasoning in `drizzle/schema.ts`); no database ever saw
  // the earlier table design.
  //
  // One transaction: interrupted, the step would replay and `CREATE TABLE` would fail.
  sqlite.exec(`
BEGIN;
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  label TEXT,
  exhausted_until INTEGER,
  exhausted_window TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_credentials_project_rank ON credentials(project_id, "rank");
ALTER TABLE sessions ADD COLUMN credential_id TEXT;
INSERT INTO credentials (id, project_id, name, "rank", ciphertext, label, created_at)
  SELECT id, project_id, name,
         ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id),
         ciphertext, label, created_at
    FROM secrets WHERE name = 'CLAUDE_CODE_OAUTH_TOKEN';
DELETE FROM secrets WHERE name = 'CLAUDE_CODE_OAUTH_TOKEN';
PRAGMA user_version = 64;
COMMIT;
`);
}

export function v65(sqlite: Database.Database): void {
  // v65: the per-session token budget goes (08/09, operator decision). It never triggered usefully,
  // needed repeated false-positive fixes, and the product already said cost is not a criterion
  // under a subscription. `stuck.mjs` catches spending without progress on a surer signal.
  //
  // `DROP COLUMN` for the same reason as v45: no index, FK or constraint references the columns.
  //
  // v61 is left alone: on a fresh database it runs first, on a column that still exists.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects DROP COLUMN token_budget;
ALTER TABLE tasks DROP COLUMN token_budget_override;
PRAGMA user_version = 65;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [61, v61],
  [62, v62],
  [63, v63],
  [64, v64],
  [65, v65],
];
