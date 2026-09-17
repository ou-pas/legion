import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

// Migrations v31 → v40.

export function v31(sqlite: Database.Database): void {
  // v31: form questions (24/08). A blocking question costs a pause → destroy → resume cycle; `form`
  // carries a declarative form (markdown, SVG, typed fields, validated by inbox-form.ts) so N
  // questions share one pause.
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN form TEXT;
PRAGMA user_version = 31;
COMMIT;
`);
}

export function v32(sqlite: Database.Database): void {
  // v32: pre-review. Comments anchored on a task branch's diff, collected offline and sent in one
  // gesture (a block in the brief plus a rerun on the same branch). `excerpt` freezes the target
  // line so the comment still says what it was about if the branch moves.
  sqlite.exec(`
BEGIN;
CREATE TABLE review_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
PRAGMA user_version = 32;
COMMIT;
`);
}

export function v33(sqlite: Database.Database): void {
  // v33: a pre-review comment has a side and a range (24/08). `side`: in a unified diff, removed
  // line 74 and added line 74 are different lines, and the comment showed under both. `start_line`:
  // NULL for a single line, else the range start_line..line anchored on its last line, as on
  // GitHub.
  sqlite.exec(`
BEGIN;
ALTER TABLE review_comments ADD COLUMN side TEXT NOT NULL DEFAULT 'new';
ALTER TABLE review_comments ADD COLUMN start_line INTEGER;
PRAGMA user_version = 33;
COMMIT;
`);
}

export function v34(sqlite: Database.Database): void {
  // v34: a repository declares its forge (26/08). GitHub was an assumption everywhere, so a GitLab
  // project's agent did not even start.
  //
  // Nullable with no default on purpose: `NULL` means "written before the question existed", not
  // "GitHub chosen". Both read as github today (`forgeOfRow`), but a DEFAULT would erase the
  // difference for good.
  sqlite.exec(`
BEGIN;
ALTER TABLE repos ADD COLUMN forge TEXT;
PRAGMA user_version = 34;
COMMIT;
`);
}

export function v35(sqlite: Database.Database): void {
  // v35: project-level capabilities (26/08). Only rules had an "all agents" checkbox; skills and MCP
  // servers were ticked agent by agent.
  //
  // A capability adds an ability and may have a project default; an access (secret, repository)
  // opens data and stays per agent, or least privilege means nothing.
  //
  // Two storages for one checkbox: an MCP server is a row, so the flag goes on the row; a skill is a
  // folder on disk, so the choice goes on the project.
  sqlite.exec(`
BEGIN;
ALTER TABLE mcp_servers ADD COLUMN all_agents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN default_skill_names TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 35;
COMMIT;
`);
}

export function v36(sqlite: Database.Database): void {
  // v36: a session event's sequence number (26/08).
  //
  // The runtime's `report()` was an unnumbered, unacknowledged POST: a container death or server
  // restart in between lost the event ("container gone without a reported result").
  //
  // `session_events.id` is a global autoincrement owned by the server. This second number, set by
  // the runtime and unique per session, allows refusing a duplicate without side effects and
  // returning an ack the runtime reads.
  //
  // Unique and nullable: pre-v36 rows and control-plane events have none, and SQLite allows many
  // NULLs in a unique index.
  sqlite.exec(`
BEGIN;
ALTER TABLE session_events ADD COLUMN seq INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS session_events_session_seq ON session_events(session_id, seq);
PRAGMA user_version = 36;
COMMIT;
`);
}

export function v37(sqlite: Database.Database): void {
  // v37: operator-requested pause (26/08). No new session status: the regular inbox pause path, as
  // for the quota pause (v28).
  //
  // The column is an intention, not a state: until the agent reads it, it is still working. The
  // runtime reads the flag at its next turn boundary, pushes its work and exits; the control plane
  // then asks the inbox question.
  sqlite.exec(`
BEGIN;
ALTER TABLE sessions ADD COLUMN pause_requested INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 37;
COMMIT;
`);
}

export function v38(sqlite: Database.Database): void {
  // v38: session resources configurable per runner (26/08). `--memory=1g --cpus=1` was hardcoded in
  // `docker.ts`, which made the repository's own instructions impossible: Storybook alone takes
  // 500 to 800 MB, the kernel killed the runtime, and the session reported an uninformative exit
  // code 1. Per runner because machines differ there. The default stays 1 GB and 1 CPU.
  sqlite.exec(`
BEGIN;
ALTER TABLE runners ADD COLUMN memory_mb INTEGER NOT NULL DEFAULT 1024;
ALTER TABLE runners ADD COLUMN cpus REAL NOT NULL DEFAULT 1;
PRAGMA user_version = 38;
COMMIT;
`);
}

export function v39(sqlite: Database.Database): void {
  // v39: scheduled tasks get a server (26/08); the screen (PR #50) called six unserved routes, the
  // gap that led to `make contract`.
  //
  // Two tables: the rule outlives its runs and the run history outlives the rule.
  //
  // `next_run_at` is computed and stored, so the tick queries an index instead of parsing thirty
  // cron expressions every thirty seconds.
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id),
  template_id TEXT,
  prompt TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(next_run_at);
CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id),
  fired_at INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  task_id TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, fired_at DESC);
PRAGMA user_version = 39;
COMMIT;
`);
}

export function v40(sqlite: Database.Database): void {
  // v40: a project describes how its sessions run (image, SSH key). NULL means as before (default
  // image, no key), so no session changes behaviour.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN session_image TEXT;
ALTER TABLE projects ADD COLUMN ssh_key_path TEXT;
PRAGMA user_version = 40;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [31, v31],
  [32, v32],
  [33, v33],
  [34, v34],
  [35, v35],
  [36, v36],
  [37, v37],
  [38, v38],
  [39, v39],
  [40, v40],
];
