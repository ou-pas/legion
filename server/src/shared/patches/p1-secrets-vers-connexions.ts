// P1: what is already known about hand-pasted tokens, written where the `connections` domain now
// reads it (15/09). The file name is French and is the patch id's origin; neither is renamed.
//
// It only copies what is already in the database: no network call. Finding a token's account and
// scopes means asking the provider, which `make adopt-tokens` (`connections/adopt-pasted.ts`) does
// when the operator decides.
//
// It never writes `account` or `scopes` (nobody knows them offline) and deletes nothing.
//
// Names are hardcoded on purpose. `shared/` is a leaf (`shared-is-a-leaf`), but even without that
// rule a patch is a snapshot of the data's history, like a migration's SQL: if `LINEAR_TOKEN` is
// renamed later, this patch must keep writing the name rows of its time expect. Future divergence
// is expected, so no drift guard.
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

/** Frozen copies of two values from `connections/providers.ts` (`TOKEN_ORIGIN`, `AUTH_FORMAT`),
 *  not a second enum declaration. */
const ORIGIN_PASTED = "pasted";
const AUTH_FORMAT_RAW = "raw";

/** Each provider's secret name as of 15/09. The `provider` written into `metadata` is a trace of
 *  what wrote the row, never a key a decision depends on (see `CredentialMetadata.provider`). */
const PROVIDER_SECRETS = [
  { name: "GITHUB_TOKEN", provider: "github" },
  { name: "GITLAB_TOKEN", provider: "gitlab" },
  { name: "LINEAR_TOKEN", provider: "linear" },
] as const;

/** The old name of a Linear personal key, unread since 15/09 (`integrations/linear.ts` knows only
 *  `LINEAR_TOKEN`): an instance carrying one has a silently mute Linear. */
const LEGACY_LINEAR_NAME = "LINEAR_API_KEY";
const LINEAR_SECRET_NAME = "LINEAR_TOKEN";
const LINEAR_PROVIDER = "linear";

/** What is known offline: origin and writer. No `authFormat`: a token pasted under `GITHUB_TOKEN`
 *  or `LINEAR_TOKEN` may be either form, and absent already reads as `bearer`. An unobserved
 *  format would fake a live-looking connection. */
function knownOffline(provider: string): string {
  return JSON.stringify({ provider, origin: ORIGIN_PASTED });
}

/** Step 1: provider rows that never had `metadata`. Reading does not change (`credentialOrigin`
 *  already returns `pasted`, absent `authFormat` is `bearer`); the row now states what the reader
 *  inferred. */
function stampPastedRows(sqlite: Database.Database): void {
  const stamp = sqlite.prepare(
    "UPDATE secrets SET metadata = ? WHERE name = ? AND metadata IS NULL",
  );
  for (const { name, provider } of PROVIDER_SECRETS) stamp.run(knownOffline(provider), name);
}

/** Step 2, the only one moving a value: `LINEAR_API_KEY` copied under `LINEAR_TOKEN`.
 *
 *  Correct only because the written `metadata` says `authFormat: raw`. `integrations/linear.ts`
 *  builds its header from that field; absent means `bearer`, and Linear would refuse
 *  `Bearer <key>` on every request, reviving the bug fixed on 15/09. `raw` is not a guess:
 *  `LINEAR_API_KEY` only ever held personal keys, which Linear reads raw.
 *
 *  An existing `LINEAR_TOKEN` is never overwritten: it is a token in service. That also makes a
 *  second pass a no-op.
 *
 *  One row per project, the most recent: (project, name) is not unique in the database, and two
 *  copies would resolve at random. SQLite's `MAX(created_at)` with bare columns returns the max
 *  row; "latest wins" is already `putSecret`'s rule. */
function copyLegacyLinear(sqlite: Database.Database): void {
  const orphans = sqlite
    .prepare(
      `SELECT project_id AS projectId, ciphertext, label, MAX(created_at) AS createdAt
         FROM secrets s
        WHERE s.name = ?
          AND NOT EXISTS (
                SELECT 1 FROM secrets t WHERE t.project_id = s.project_id AND t.name = ?
              )
        GROUP BY s.project_id`,
    )
    .all(LEGACY_LINEAR_NAME, LINEAR_SECRET_NAME) as {
    projectId: string;
    ciphertext: string;
    label: string | null;
    createdAt: number;
  }[];
  const metadata = JSON.stringify({
    provider: LINEAR_PROVIDER,
    origin: ORIGIN_PASTED,
    authFormat: AUTH_FORMAT_RAW,
  });
  const insert = sqlite.prepare(
    `INSERT INTO secrets
       (id, project_id, name, ciphertext, label, created_at, refresh_ciphertext, metadata)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  );
  for (const row of orphans)
    // The original's `created_at`: the screen shows the operator's gesture date. No
    // `refresh_ciphertext`: a personal key cannot be renewed.
    insert.run(
      nanoid(10),
      row.projectId,
      LINEAR_SECRET_NAME,
      row.ciphertext,
      row.label,
      row.createdAt,
      metadata,
    );
}

/** The patch: enrich what is there, then add what is missing. */
export const p1SecretsVersConnexions = {
  /** Stored in `patches`; never renamed, or the patch would replay everywhere. */
  id: "p1-secrets-vers-connexions",
  apply(sqlite: Database.Database): void {
    stampPastedRows(sqlite);
    copyLegacyLinear(sqlite);
  },
};
