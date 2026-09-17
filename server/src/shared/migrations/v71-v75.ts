import type Database from "better-sqlite3";
import type { MigrationStep } from "./step.js";

export function v71(sqlite: Database.Database): void {
  // v71: operator sessions (13/09).
  //
  // A table rather than the token as a cookie: what authorises is the session. The token is one way
  // to get one; a security key (WebAuthn, after TLS) or SSO would be others, added without touching
  // the guard.
  //
  // `method` records how the session was obtained; it decides nothing today.
  //
  // In the database, not memory: the control plane restarts on every update, and being logged out
  // each deploy is the friction that ends with security switched off.
  //
  // The token hash lives in `settings` (`operator.token_hash`), one per instance. The plain token is
  // stored nowhere; it is printed once at the boot that generates it.
  sqlite.exec(`
BEGIN;
CREATE TABLE operator_sessions (
  id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
PRAGMA user_version = 71;
COMMIT;
`);
}

export function v72(sqlite: Database.Database): void {
  // v72: Web Push subscriptions (13/09). The browser makes them: `endpoint` is the vendor push URL
  // (Apple, Google, Mozilla), `p256dh` and `auth` the keys encrypting the message so the service
  // cannot read it.
  //
  // The endpoint is the natural key, hence uniqueness: a phone reinstalling returns the same
  // endpoint, and without it would vibrate twice, then three times.
  //
  // Subscriptions die on their own: a 404 or 410 is the only signal, and the row is deleted then.
  //
  // `events` has the webhooks' shape: push is an output of `notifyOut`, next to webhooks, not a
  // notifier (like Discord), which only receives finished text. Empty list = everything. A phone
  // that buzzes for every PR gets muted, and then the gate that matters wakes nobody.
  sqlite.exec(`
BEGIN;
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  label TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
PRAGMA user_version = 72;
COMMIT;
`);
}

export function v73(sqlite: Database.Database): void {
  // v73: tool grants survive the product rename (14/09). The internal MCP server went from `agentos`
  // to `legion`; the code followed, but explicit `allowed_tools` rows kept names matching no tool.
  //
  // In `permissionMode: "dontAsk"` an unlisted tool is refused with the SDK's message, not ours: the
  // `interviewer` saw `inbox_ask`, `inbox_send` and `fs_write` refused and asked for rights it
  // already had.
  //
  // Only this column is rewritten. The old prefix also appears in `tasks.description`,
  // `session_events.payload` and `inbox_messages.evidence` (1 820 rows): traces, not rewritten.
  // Agents with NULL `allowed_tools` were never affected.
  sqlite.exec(`
BEGIN;
UPDATE agents
   SET allowed_tools = replace(allowed_tools, 'mcp__agentos__', 'mcp__legion__')
 WHERE allowed_tools LIKE '%mcp__agentos__%';
UPDATE agent_templates
   SET allowed_tools = replace(allowed_tools, 'mcp__agentos__', 'mcp__legion__')
 WHERE allowed_tools LIKE '%mcp__agentos__%';
PRAGMA user_version = 73;
COMMIT;
`);
}

// v74: what is known about a credential without opening it (15/09).
//
// `refresh_ciphertext` is specific: only the refresh token is ever encrypted there.
//
// `metadata` is an open bag (expiry, account, granted scopes, future integration data) with one
// invariant: everything in it is readable without the master key. No secret goes in.
//
// Plain rather than encrypted: an encrypted blob cannot answer "which tokens expire within the
// hour", cannot be fixed by a migration, and cannot be shown; `json_extract` can. Same reasoning as
// `label` in v48.
//
// Both NULL on existing rows, meaning a hand-pasted secret Legion cannot renew.
export function v74(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
ALTER TABLE secrets ADD COLUMN refresh_ciphertext TEXT;
ALTER TABLE secrets ADD COLUMN metadata TEXT;
PRAGMA user_version = 74;
COMMIT;
`);
}

// v75: the data patches table (15/09). A migration describes shape and must pass before anything
// reads the database; a patch describes content and never blocks the boot. This table is shape, so
// a migration creates it.
//
// `id` is the patch name, not a number, so parallel work adding patches merges without fighting over
// an integer.
//
// Three deliberate absences compared with `rappasoft/laravel-patches`:
//   · no `down`: the previous data no longer exists, and "undoing" would present a reconstruction
//     as the original;
//   · no batch number: without `down` it has no use;
//   · no failure column: a failed patch is simply not marked, replays at the next boot, and is
//     logged to `control_events`.
export function v75(sqlite: Database.Database): void {
  sqlite.exec(`
BEGIN;
CREATE TABLE patches (
  id TEXT PRIMARY KEY,
  ran_at INTEGER NOT NULL
);
PRAGMA user_version = 75;
COMMIT;
`);
}

export const steps: MigrationStep[] = [
  [71, v71],
  [72, v72],
  [73, v73],
  [74, v74],
  [75, v75],
];
