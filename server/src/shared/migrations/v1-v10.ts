import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { MigrationStep } from "./step.js";

// Migrations v1 → v10, moved unchanged from `db.ts`.

export function v1(sqlite: Database.Database): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5', repo_url TEXT,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', model TEXT,
  role_prompt TEXT NOT NULL, runner_preference TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS runners (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  docker_host TEXT, max_concurrent_sessions INTEGER NOT NULL DEFAULT 3,
  enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo', assignee_agent_id TEXT REFERENCES agents(id),
  model_override TEXT, approval_gate INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_activity (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  "from" TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  runner_id TEXT NOT NULL REFERENCES runners(id),
  model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'starting',
  callback_token TEXT NOT NULL, runtime_handle TEXT, sdk_session_id TEXT,
  cost_usd REAL, event_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL, ended_at INTEGER);
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
PRAGMA user_version = 1;
`);
}

export function v2(sqlite: Database.Database): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, networking TEXT NOT NULL DEFAULT 'open',
  allowed_hosts TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, ciphertext TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL, body TEXT NOT NULL, choices TEXT,
  selected_choice_id TEXT, answer_text TEXT,
  status TEXT NOT NULL DEFAULT 'open', telegram_message_id INTEGER,
  created_at INTEGER NOT NULL, answered_at INTEGER);
ALTER TABLE agents ADD COLUMN environment_id TEXT REFERENCES environments(id);
ALTER TABLE agents ADD COLUMN fs_grants TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN allowed_tools TEXT;
ALTER TABLE agents ADD COLUMN env_secret_names TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN repo_access TEXT NOT NULL DEFAULT 'none';
ALTER TABLE agents ADD COLUMN inbox_access INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN resume_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN mock INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 2;
`);
}

export function v3(sqlite: Database.Database): void {
  // Transactional (review P3 #5): an interrupted multi-ALTER migration must never
  // leave a half-migrated DB that fails with "duplicate column" on the next boot.
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL, auto_run_next INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL);
ALTER TABLE projects ADD COLUMN fs_root TEXT;
ALTER TABLE tasks ADD COLUMN template_run_id TEXT;
ALTER TABLE tasks ADD COLUMN step_index INTEGER;
ALTER TABLE tasks ADD COLUMN blocked_by_task_id TEXT;
ALTER TABLE tasks ADD COLUMN expected_artifacts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN step_prompt TEXT;
ALTER TABLE tasks ADD COLUMN scheduled_at INTEGER;
ALTER TABLE tasks ADD COLUMN template_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_template_run ON tasks(template_run_id);
PRAGMA user_version = 3;
COMMIT;
`);
}

export function v4(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, request TEXT NOT NULL,
  dod TEXT NOT NULL DEFAULT '[]', dod_approved INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  allowed_agent_ids TEXT NOT NULL DEFAULT '[]',
  budget_usd REAL, max_duration_ms INTEGER, max_no_progress INTEGER NOT NULL DEFAULT 3,
  spent_usd REAL NOT NULL DEFAULT 0, no_progress_streak INTEGER NOT NULL DEFAULT 0,
  iterations INTEGER NOT NULL DEFAULT 0, mock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER);
CREATE TABLE IF NOT EXISTS goal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
ALTER TABLE tasks ADD COLUMN goal_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_events_goal ON goal_events(goal_id);
PRAGMA user_version = 4;
COMMIT;
`);
}

export function v5(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, config TEXT NOT NULL,
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL);
ALTER TABLE agents ADD COLUMN mcp_server_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN skill_names TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_project_name ON mcp_servers(project_id, name);
PRAGMA user_version = 5;
COMMIT;
`);
}

export function v6(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, content TEXT NOT NULL,
  all_agents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
ALTER TABLE agents ADD COLUMN rule_ids TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 6;
COMMIT;
`);
}

export function v7(sqlite: Database.Database): void {
  // Everything in one transaction, backfill included: a crash must never leave user_version=7 with
  // a partial backfill (v3 invariant, night review #3).
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, url TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repos_project_name ON repos(project_id, name);
ALTER TABLE agents ADD COLUMN repo_names TEXT NOT NULL DEFAULT '[]';
`);
  // Backfill: the old projects.repo_url becomes the project's "main" repo, and agents with global
  // repo access keep it (repoNames = ["main"]).
  const withUrl = sqlite
    .prepare("SELECT id, repo_url FROM projects WHERE repo_url IS NOT NULL AND repo_url != ''")
    .all() as { id: string; repo_url: string }[];
  const insRepo = sqlite.prepare(
    "INSERT INTO repos (id, project_id, name, url, created_at) VALUES (?, ?, 'main', ?, ?)",
  );
  const grantAgents = sqlite.prepare(
    "UPDATE agents SET repo_names = '[\"main\"]' WHERE project_id = ? AND repo_access != 'none'",
  );
  for (const p of withUrl) {
    insRepo.run(nanoid(10), p.id, p.repo_url, Date.now());
    grantAgents.run(p.id);
  }
  sqlite.exec("PRAGMA user_version = 7; COMMIT;");
}

export function v8(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN pr_urls TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 8;
COMMIT;
`);
}

export function v9(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN external_ref TEXT;
PRAGMA user_version = 9;
COMMIT;
`);
}

export function v10(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE rules ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
PRAGMA user_version = 10;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [1, v1],
  [2, v2],
  [3, v3],
  [4, v4],
  [5, v5],
  [6, v6],
  [7, v7],
  [8, v8],
  [9, v9],
  [10, v10],
];
