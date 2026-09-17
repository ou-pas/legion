import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

// Migrations v46 → v50.

export function v46(sqlite: Database.Database): void {
  // v46: a task's criteria. A slice carries a contract written up front, a validation command and
  // one to three typed criteria (`{ validatedBy, items: [{ text, mode, edge? }] }`), in one column
  // since they are one object. NULL by default: tasks without criteria behave as before.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN criteria TEXT;
PRAGMA user_version = 46;
COMMIT;
`);
}

export function v47(sqlite: Database.Database): void {
  // v47: a project's chosen hue (nav slice 05). The mark is derived from name and id; this is an
  // optional override on the existing settings screen.
  //
  // NULL keeps the hashed hue: the column says "someone overrode the derivation". A rank on the
  // twelve-step scale of `web/src/ui/tokens.css`, never a colour, so the palette can change freely.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN hue INTEGER;
PRAGMA user_version = 47;
COMMIT;
`);
}

export function v48(sqlite: Database.Database): void {
  // v48: a key's label (nav slice 08), so the quota chip says which account is being drained.
  //
  // A column, not inside the ciphertext: a secret that stops decrypting would otherwise lose its
  // name exactly when one looks for the broken one.
  //
  // NULL by default (not the same as an erased label); the screen shows the variable name.
  sqlite.exec(`
BEGIN;
ALTER TABLE secrets ADD COLUMN label TEXT;
PRAGMA user_version = 48;
COMMIT;
`);
}

export function v49(sqlite: Database.Database): void {
  // v49: concierge memory (nav slice 10). The client used to replay the history, which did not
  // survive a reload and made the browser the source of truth.
  //
  // No conversations table: a conversation is the turns sharing its id.
  //
  // No foreign key: the concierge belongs to no object, and a conversation survives deleting the
  // project it discussed.
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS concierge_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_concierge_turns_conversation
  ON concierge_turns(conversation_id, created_at);
PRAGMA user_version = 49;
COMMIT;
`);
}

export function v50(sqlite: Database.Database): void {
  // v50: conventional branches (nav slice 15). The work type (conventionalbranch.org) and the
  // branch it names, fixed at first derivation: a task rename must not move the branch under
  // pushed work.
  //
  // The narrow backfill matters: tasks that already ran pushed to `legion/<scope>`, which the review
  // diff, PR opening and wait wake-up reread later; a new branch would give an empty diff and a PR
  // without commits, silently. They keep exactly their branch. Never-run tasks stay `NULL`.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT 'chore';
ALTER TABLE tasks ADD COLUMN branch TEXT;
UPDATE tasks SET branch = 'legion/' || COALESCE(template_run_id, goal_id, id)
  WHERE id IN (SELECT DISTINCT task_id FROM sessions);
PRAGMA user_version = 50;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [46, v46],
  [47, v47],
  [48, v48],
  [49, v49],
  [50, v50],
];
