import type Database from "better-sqlite3";

// Own leaf file, like `migrations/step.ts`: declared in `index.ts`, it would create an import
// cycle with every patch.

/** A data patch: its name and what it applies.
 *
 *  `id` is what `patches` stores, so it is never renamed, or the patch would replay everywhere.
 *
 *  The function sets no mark, unlike a `MigrationStep`: the runner opens the transaction, calls
 *  the patch and inserts the `patches` row in the same transaction, so work and mark are written
 *  together or not at all.
 *
 *  The one prohibition: opening or closing a transaction (no `BEGIN`, `COMMIT`, `ROLLBACK`,
 *  `sqlite.transaction(…)`). Every migration uses `exec("BEGIN; … COMMIT;")`; copied here, the
 *  `COMMIT` would close the runner's transaction. The runner refuses it (`sqlite.inTransaction`
 *  checked after the call).
 *
 *  No `down`: see migration v75. The previous data no longer exists. */
export type DataPatch = { id: string; apply: (sqlite: Database.Database) => void };
