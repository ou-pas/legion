import type Database from "better-sqlite3";

// Own leaf file (06/09): declared in `index.ts`, it made an import cycle with every range file.

/** A schema version and the function applying it. The function sets its own
 *  `PRAGMA user_version = N` (inside its transaction when it opens one), so the migration and its
 *  mark are written together or not at all. */
export type MigrationStep = [version: number, apply: (sqlite: Database.Database) => void];
