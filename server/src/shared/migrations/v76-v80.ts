// Migrations v76 onward. Array order is application order (see index.ts).
import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

// v76: red CI watch on open PRs (29/09). A server timer probes the CI of `review` tasks' open PRs
// every 5 minutes and relaunches `fixCi` automatically — see `review/ci-watch.ts`.
//
// `ci_watch` is a per-project switch, on by default: the operator accepted the token cost of
// sessions launched without a click rather than a silent opt-in nobody remembers to flip.
//
// `ci_watch_state` is the counter, one row per (task, repo, PR number): how many automatic attempts
// ran since the last green CI, and whether the exhaustion notification was already sent. A table,
// not a control-log scan (`lastMergePartialCount`'s pattern), because this value is mutated in
// place on every tick rather than only ever appended: a counter that resets wants an UPDATE, not a
// rescan of history to find the latest line. `ON DELETE CASCADE`: a deleted task leaves no orphan
// counter behind.
export function v76(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN ci_watch INTEGER NOT NULL DEFAULT 1;
CREATE TABLE ci_watch_state (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  repo_name TEXT NOT NULL,
  number INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, repo_name, number)
);
PRAGMA user_version = 76;
COMMIT;
`);
}

export const steps: MigrationStep[] = [[76, v76]];
