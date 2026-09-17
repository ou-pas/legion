import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

// Migrations v51 → v55.

export function v51(sqlite: Database.Database): void {
  // v51: the fleet becomes declarable and observed (multi-machine slice 01): the control plane runs
  // on the home server, sessions on stronger machines that sleep.
  //
  // `callback_url`: the return address depends on the runner. A global `LEGION_CALLBACK_URL` (or
  // localhost) made a container on another machine call its own localhost. NULL = unchanged.
  //
  // `last_seen_at`: when the daemon last answered, kept by the probe and used by `pickRunnerRow`.
  //
  // The backfill is deliberate: without it every existing runner would be unreachable until the
  // first probe pass. The probe corrects a wrong grace within two periods, the cheaper error.
  sqlite.exec(`
BEGIN;
ALTER TABLE runners ADD COLUMN callback_url TEXT;
ALTER TABLE runners ADD COLUMN last_seen_at INTEGER;
UPDATE runners SET last_seen_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
PRAGMA user_version = 51;
COMMIT;
`);
}

export function v52(sqlite: Database.Database): void {
  // v52: fleet usage history (02/09, after "No space left on device": see a full Docker runner before
  // a session fails on it). New table, no backfill; the next probe pass (30 s) fills it.
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS runner_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runner_id TEXT NOT NULL REFERENCES runners(id),
  at INTEGER NOT NULL,
  source TEXT NOT NULL,
  cpu REAL,
  mem REAL);
CREATE INDEX IF NOT EXISTS idx_runner_metrics_runner_at ON runner_metrics(runner_id, at);
PRAGMA user_version = 52;
COMMIT;
`);
}

export function v53(sqlite: Database.Database): void {
  // v53: read-only task (03/09: a validation task briefed "push nothing" ended with a pushed branch and
  // an MR, since the end-of-session net commits and pushes any dirty tree). Forces `access: "read"`:
  // the permission holds what an instruction cannot. Default 0.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 53;
COMMIT;
`);
}

export function v54(sqlite: Database.Database): void {
  // v54: cancelling is not failing (03/09). `killGoal` wrote `failed`, like a broken loop; it now
  // writes `cancelled`.
  //
  // No column changes (`goals.status` is TEXT without CHECK). This is a catch-up: past kills are
  // recognised by `{"status":"failed","killed":true}` in `goal_events`, whose only writer is
  // `killGoal`. A `failed` goal without it is a real failure and stays.
  sqlite.exec(`
BEGIN;
UPDATE goals SET status = 'cancelled'
 WHERE status = 'failed'
   AND id IN (SELECT goal_id FROM goal_events
               WHERE type = 'status' AND payload LIKE '%"killed":true%');
PRAGMA user_version = 54;
COMMIT;
`);
}

export function v55(sqlite: Database.Database): void {
  // v55: inbound webhooks (03/09). The forge hook id, stored on the repository it listens to; NULL =
  // not connected. The secret and public URL are instance settings (no migration).
  //
  // `webhook_url` next to the id (architect review): without the target, a "connected" hook cannot be
  // checked once the public URL changes; storing it lets the screen say "reconnect".
  sqlite.exec(`
BEGIN;
ALTER TABLE repos ADD COLUMN webhook_id TEXT;
ALTER TABLE repos ADD COLUMN webhook_url TEXT;
PRAGMA user_version = 55;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [51, v51],
  [52, v52],
  [53, v53],
  [54, v54],
  [55, v55],
];
