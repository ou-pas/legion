import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

// Migrations v11 → v20.

export function v11(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE goals ADD COLUMN plan TEXT NOT NULL DEFAULT '[]';
ALTER TABLE repos ADD COLUMN test_command TEXT;
ALTER TABLE projects ADD COLUMN context TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY, url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agent_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
  model TEXT, role_prompt TEXT NOT NULL, allowed_tools TEXT,
  repo_access TEXT NOT NULL DEFAULT 'none', inbox_access INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 11;
COMMIT;
`);
}

export function v12(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN complexity TEXT NOT NULL DEFAULT 'med';
ALTER TABLE inbox_messages ADD COLUMN on_answer TEXT NOT NULL DEFAULT 'resume';
PRAGMA user_version = 12;
COMMIT;
`);
}

export function v13(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'med';
ALTER TABLE tasks ADD COLUMN queued INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 13;
COMMIT;
`);
}

export function v14(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'info',
  body TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
PRAGMA user_version = 14;
COMMIT;
`);
}

export function v15(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 15;
COMMIT;
`);
}

export function v16(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN evidence TEXT;
ALTER TABLE inbox_messages ADD COLUMN impact TEXT;
PRAGMA user_version = 16;
COMMIT;
`);
}

export function v17(sqlite: Database.Database): void {
  // v17: effort and thinking mode become agent settings, like the model. NULL lets the SDK decide.
  //
  // The data half matters most: the database held retired model ids (`claude-opus-4-5`,
  // `claude-sonnet-4-5`) that the API refused. They become tier aliases, which follow the current
  // version. Limited to the three known dead ids: another pinned version is the operator's choice.
  sqlite.exec(`
BEGIN;
ALTER TABLE agents ADD COLUMN effort TEXT;
ALTER TABLE agents ADD COLUMN thinking TEXT;
ALTER TABLE agents ADD COLUMN thinking_budget INTEGER;
UPDATE projects SET default_model = 'opus'   WHERE default_model = 'claude-opus-4-5';
UPDATE projects SET default_model = 'sonnet' WHERE default_model = 'claude-sonnet-4-5';
UPDATE projects SET default_model = 'haiku'  WHERE default_model = 'claude-haiku-4-5';
UPDATE agents   SET model = 'opus'   WHERE model = 'claude-opus-4-5';
UPDATE agents   SET model = 'sonnet' WHERE model = 'claude-sonnet-4-5';
UPDATE agents   SET model = 'haiku'  WHERE model = 'claude-haiku-4-5';
UPDATE tasks    SET model_override = 'opus'   WHERE model_override = 'claude-opus-4-5';
UPDATE tasks    SET model_override = 'sonnet' WHERE model_override = 'claude-sonnet-4-5';
UPDATE tasks    SET model_override = 'haiku'  WHERE model_override = 'claude-haiku-4-5';
PRAGMA user_version = 17;
COMMIT;
`);
}

export function v18(sqlite: Database.Database): void {
  // v18: chain library. `task_templates.project_id` is NOT NULL, so a chain vanished with its
  // project. Like `agent_templates`, this table holds chains outside any project, installed where
  // wanted (catalog.ts).
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS chain_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL, auto_run_next INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL);
PRAGMA user_version = 18;
COMMIT;
`);
}

export function v19(sqlite: Database.Database): void {
  // v19: git identity for agent commits, per project (git-identity.ts). NULL falls back to the
  // default ("Legion" / "legion@local"), so existing projects behave as before.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN git_author_name TEXT;
ALTER TABLE projects ADD COLUMN git_author_email TEXT;
PRAGMA user_version = 19;
COMMIT;
`);
}

export function v20(sqlite: Database.Database): void {
  // v20 (20/08): control plane trace. A dedicated table, not `notices` (low-volume human read/unread
  // notifications): this holds operational reasoning at much higher volume, with rotation. See
  // `logControlEvent` in `shared/db.ts`.
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS control_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_control_events_created ON control_events(created_at);
CREATE INDEX IF NOT EXISTS idx_control_events_level ON control_events(level);
PRAGMA user_version = 20;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [11, v11],
  [12, v12],
  [13, v13],
  [14, v14],
  [15, v15],
  [16, v16],
  [17, v17],
  [18, v18],
  [19, v19],
  [20, v20],
];
