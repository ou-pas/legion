// Migrations v56 to v60. Array order is application order (see index.ts).
import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

export function v56(sqlite: Database.Database): void {
  // v56: settling says why (03/09). `settleTaskAfterSession` set `review` on any session end
  // (delivered work, OOM, API error, stop), so the board showed "ready to review" on tasks that
  // produced nothing. That day: an OOM (exit 137) after 49 unpushed file writes, and six attempts
  // dead on "API Error: 529 Overloaded" reported by the SDK as `success`.
  //
  // No catch-up, unlike v54: rebuilding it from `session_events` would freeze the settle rule in SQL
  // and let it drift. `null` on existing rows reads correctly: settled without a finding.
  sqlite.exec(`
BEGIN;
ALTER TABLE tasks ADD COLUMN settled_outcome TEXT;
PRAGMA user_version = 56;
COMMIT;
`);
}

export function v57(sqlite: Database.Database): void {
  // v57: why a session waits (03/09). One status, `waiting-inbox`, carried six situations the screen
  // could only tell apart by reading the message body.
  //
  // Partial catch-up on purpose: three reasons can be read from existing columns. Approval is not
  // stored on the entry, and an operator pause cannot be derived (the reason for this column); past
  // entries of those kinds stay "question", as they always showed.
  //
  // CASE order follows `deriveWaitReason` (inbox/wait-reason.ts): dependency and wake-up first.
  sqlite.exec(`
BEGIN;
ALTER TABLE inbox_messages ADD COLUMN reason TEXT;
UPDATE inbox_messages SET reason = CASE
  WHEN wait_for_task_id IS NOT NULL THEN 'dependency'
  WHEN wake_at IS NOT NULL THEN 'quota-pause'
  WHEN on_answer = 'retry-task' THEN 'diagnostic'
  ELSE 'question'
END;
PRAGMA user_version = 57;
COMMIT;
`);
}

export function v58(sqlite: Database.Database): void {
  // v58: operator pauses already stored (03/09). They do carry a signature: `pauseForOperator`
  // (sessions/operator-pause.ts) writes a fixed server `body`, unchanged since 26/08 (checked with
  // `git log -S`). The matched French text is that legacy body and must stay as is.
  //
  // Limited to `reason = 'question'`, the only reason v57 could have set wrongly.
  //
  // Approval gates remain unrecoverable: the flag is not stored on the entry, and no `blocked`
  // session with an open entry existed on 03/09.
  sqlite.exec(`
BEGIN;
UPDATE inbox_messages SET reason = 'operator-pause'
 WHERE reason = 'question'
   AND body LIKE 'Mise en pause à ta demande.%';
PRAGMA user_version = 58;
COMMIT;
`);
}

export function v59(sqlite: Database.Database): void {
  // v59: `waiting-inbox` becomes `waiting` (03/09). The name described the channel, not the state; the
  // reason moved to `inbox_messages.reason` in v57.
  //
  // No column changes (`sessions.status` is TEXT without CHECK, as in v54): a complete data
  // conversion.
  //
  // Existing `session_events` payloads citing `waiting-inbox` are left alone: they are timestamped
  // facts, and rewriting them would falsify a trace.
  sqlite.exec(`
BEGIN;
UPDATE sessions SET status = 'waiting' WHERE status = 'waiting-inbox';
PRAGMA user_version = 59;
COMMIT;
`);
}

export function v60(sqlite: Database.Database): void {
  // v60: a rule can say when it applies (03/09). Measured first: all 32 rules had an empty
  // `summary`, so the v41 two-tier setup never ran, and every session's system prompt carried
  // 23.9 kB of rules. Nobody summarises 32 rules by hand; a rule loaded only when relevant needs no
  // summary.
  //
  // `paths`: JSON `string[]` of globs, the same grammar as Claude Code's `.claude/rules/*.md`
  // frontmatter. Empty = always applies, the default, so no prompt changes.
  //
  // First of three steps: the field exists; then fill it; then switch on native SDK loading
  // (`settingSources: ["project"]`), with `promptBytes` to prove the gain.
  sqlite.exec(`
BEGIN;
ALTER TABLE rules ADD COLUMN paths TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 60;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [56, v56],
  [57, v57],
  [58, v58],
  [59, v59],
  [60, v60],
];
