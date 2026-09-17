// Migrations v66 to v70. Array order is application order (see index.ts).
import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

export function v66(sqlite: Database.Database): void {
  // v66: the runner chosen for a task (09/09, operator decision). On 01/09 the `local` runner lost its
  // session image and two tasks died although other machines had it. NULL (the default) lets the
  // control plane decide, as before.
  //
  // An id, not a name (unlike `agents.runner_preference`): a rename must not silently undo the
  // choice. A deleted runner leaves a dangling id on purpose: launching refuses it by name
  // (`sessions/runner/chosen-runner.ts`) rather than routing elsewhere silently.
  //
  // No `REFERENCES runners(id)`: a FK would either block deletion or cascade-erase the operator's
  // setting without a word.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN chosen_runner_id TEXT;
PRAGMA user_version = 66;
COMMIT;
`);
}

export function v67(sqlite: Database.Database): void {
  // v67: a Dockerfile pasted into project settings (09/09). `.legion/Dockerfile` in a repository meant
  // cloning it on the Docker host outside a session, with the operator's SSH key in the build
  // container, for a need that is usually `FROM legion-session:latest` plus an `apt-get`. `NULL` =
  // nothing beyond `session_image`.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN session_dockerfile TEXT;
PRAGMA user_version = 67;
COMMIT;
`);
}

export function v68(sqlite: Database.Database): void {
  // v68: the repository an inbox entry requests (09/09, task ZsbmD_N-zS). An agent asked for an
  // ungranted repository with a made-up "grant" choice; nothing honoured it, the agent cloned it
  // itself, and two commits were lost with the volume.
  //
  // Holds the requested repository name (`request_repo`); on "grant", `answerInbox` adds it to the
  // agent card before resuming, like `wait_for_task_id`. NULL = ordinary question.
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN grant_repo_name TEXT;
PRAGMA user_version = 68;
COMMIT;
`);
}

export function v69(sqlite: Database.Database): void {
  // v69: lost cost of resumed sessions (10/09). `cost_usd` was overwritten by the last run, while the
  // SDK bills each `query()` separately (`RPXUHq0upSK-`: $0.94, $0, $3.40). 68 of 316 sessions had a
  // resume, so goal budgets, standup, agent analytics and concierge context undercounted.
  //
  // Each run's `result` event kept its `costUsd`, so the fix is a sum, not an estimate. Limited to
  // sessions with two or more `result`s, which makes it monotonic (costs can only go up).
  sqlite.exec(`
BEGIN;
UPDATE sessions SET cost_usd = (
  SELECT SUM(json_extract(e.payload, '$.costUsd'))
  FROM session_events e
  WHERE e.session_id = sessions.id AND e.type = 'result'
    AND json_extract(e.payload, '$.costUsd') IS NOT NULL)
WHERE (
  SELECT COUNT(*) FROM session_events e
  WHERE e.session_id = sessions.id AND e.type = 'result'
    AND json_extract(e.payload, '$.costUsd') IS NOT NULL) > 1;
PRAGMA user_version = 69;
COMMIT;
`);
}

export function v70(sqlite: Database.Database): void {
  // v70: what a "Rebuild" answer must rebuild (12/09). A missing session image blocked every task
  // targeting that machine, retried every thirty seconds; the fix existed
  // (`POST /api/infra/:runnerId/rebuild-image`) but was never offered. One inbox question per machine
  // and image; this field says which machine, image and project. NULL = ordinary question.
  //
  // In the database although the wait lives in memory: deduplication reads the open question here,
  // which survives a control plane restart.
  //
  // JSON in a TEXT column like `choices` and `form`: the facts are always read together.
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN image_rebuild TEXT;
PRAGMA user_version = 70;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [66, v66],
  [67, v67],
  [68, v68],
  [69, v69],
  [70, v70],
];
