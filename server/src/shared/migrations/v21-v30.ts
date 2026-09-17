import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

// Migrations v21 → v30.

export function v21(sqlite: Database.Database): void {
  // v21: Kanban drag and drop. A fractional rank rather than a dense integer: moving a card
  // recomputes only its own rank (the mean of its neighbours), never the whole column
  // (task-move.ts). Backfill `board_order = created_at` keeps the implicit oldest-first order.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN board_order REAL NOT NULL DEFAULT 0;
UPDATE tasks SET board_order = created_at;
PRAGMA user_version = 21;
COMMIT;
`);
}

export function v22(sqlite: Database.Database): void {
  // v22: a session's end reason, persisted. It lived only in the published event; the session list
  // must say why each stopped without replaying traces. Older sessions keep NULL.
  sqlite.exec(`
BEGIN;
ALTER TABLE sessions ADD COLUMN end_reason TEXT;
PRAGMA user_version = 22;
COMMIT;
`);
}

export function v23(sqlite: Database.Database): void {
  // v23: steering, the queue of human messages pushed into a live session. Indexed on
  // (session, delivered_at): the hot read is "what remains to deliver to this session", every 20 s.
  sqlite.exec(`
BEGIN;
CREATE TABLE IF NOT EXISTS session_steers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'human',
  created_at INTEGER NOT NULL,
  delivered_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_session_steers_pending ON session_steers(session_id, delivered_at);
PRAGMA user_version = 23;
COMMIT;
`);
}

export function v24(sqlite: Database.Database): void {
  // v24: complexity → model routing configurable per project (was hardcoded low→haiku,
  // high→opus). The ALTER's `DEFAULT` fills existing and future rows, so behaviour does not change
  // silently.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN model_routing TEXT NOT NULL DEFAULT '{"low":"haiku","high":"opus"}';
PRAGMA user_version = 24;
COMMIT;
`);
}

export function v25(sqlite: Database.Database): void {
  // v25: tasks proposed by an agent (MCP `propose_task`) for work outside its scope, which used to
  // end up in unread reports. Created in `later`, never queued or assigned (task-propose.ts); these
  // columns only trace provenance for the screen. No backfill.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN proposed_by_agent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN proposed_by_session_id TEXT;
ALTER TABLE tasks ADD COLUMN proposed_from_task_id TEXT;
ALTER TABLE tasks ADD COLUMN proposed_agent_name TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_proposed_by_session ON tasks(proposed_by_session_id);
PRAGMA user_version = 25;
COMMIT;
`);
}

export function v26(sqlite: Database.Database): void {
  // v26: `wait_for_task` (23/08): a session hitting a dependency sleeps and wakes when that task is
  // done. No new session status; the regular inbox pause path. Only the trigger changes:
  //  · `wait_for_task_id`: the awaited task, answered by `onTaskDone` (wait-for-task.ts). No
  //    REFERENCES: the target may be deleted, which yields a named wake-up, never a cascade.
  //  · `answered_by`: "human" or "system", so the trace says who woke the session.
  // No backfill; older answers keep a NULL origin.
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN wait_for_task_id TEXT;
ALTER TABLE inbox_messages ADD COLUMN answered_by TEXT;
CREATE INDEX IF NOT EXISTS idx_inbox_wait_for_task ON inbox_messages(wait_for_task_id);
PRAGMA user_version = 26;
COMMIT;
`);
}

export function v27(sqlite: Database.Database): void {
  // v27: per-session budget guardrail (23/08: one run cost $32, unseen by stuck.mjs since it kept
  // progressing). The SDK reports `total_cost_usd` only at the end, so the cap is on cumulative
  // tokens, never a price table that would go stale. The ALTER `DEFAULT` fills existing rows, as
  // in v24; `tasks.token_budget_override` stays NULL, set at creation like `model_override`.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN token_budget INTEGER NOT NULL DEFAULT 3000000;
ALTER TABLE tasks ADD COLUMN token_budget_override INTEGER;
PRAGMA user_version = 27;
COMMIT;
`);
}

export function v28(sqlite: Database.Database): void {
  // v28: scheduled wake-up of an inbox entry (out-of-quota pause, 23/08: the 5 h subscription window
  // ran out, the SDK ended with "success" and two tasks were stuck in doing under a green chip).
  // The scheduler wakes an open entry at `wake_at` with `answered_by = system`; the human may answer
  // first. NULL for existing rows and ordinary questions.
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN wake_at INTEGER;
PRAGMA user_version = 28;
COMMIT;
`);
}

export function v29(sqlite: Database.Database): void {
  // v29: per-project override of chain agents (23/08). A catalogue chain declares roles (the step's
  // agent name); the project maps role → agentId, falling back to the catalogue, like
  // `model_routing` (v24). '{}' = no mapping, unchanged behaviour.
  sqlite.exec(`
BEGIN;
ALTER TABLE projects ADD COLUMN chain_bindings TEXT NOT NULL DEFAULT '{}';
PRAGMA user_version = 29;
COMMIT;
`);
}

export function v30(sqlite: Database.Database): void {
  // v30: per-agent browser grant (QHHXj9Q5MI, 23/08: a session was SIGKILLed installing Chromium in
  // its container). The browser is a shared long-lived service per runner (official Playwright
  // image, internal network without egress); a granted agent gets BROWSER_WS_ENDPOINT. Off by
  // default.
  sqlite.exec(`
BEGIN;
ALTER TABLE agents ADD COLUMN browser_access INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 30;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [21, v21],
  [22, v22],
  [23, v23],
  [24, v24],
  [25, v25],
  [26, v26],
  [27, v27],
  [28, v28],
  [29, v29],
  [30, v30],
];
