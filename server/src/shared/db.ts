import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { desc, eq, lte } from "drizzle-orm";
import * as schema from "../../drizzle/schema.js";
import { runMigrations } from "./migrations/index.js";
import { runPatches } from "./patches/index.js";

const DB_PATH = process.env.LEGION_DB ?? "legion.db";
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
// With WAL (05/09): better-sqlite3 is synchronous, so without `busy_timeout` a write colliding
// with another writer (scheduler tick, session report, migration) throws `SQLITE_BUSY` at once
// where five seconds of waiting would do. `synchronous = NORMAL` is the recommended WAL mode: no
// fsync per transaction for a guarantee the WAL already gives.
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");

// Versioned migrations (PRAGMA user_version) live in `./migrations/`.
const migrated = runMigrations(sqlite);

// Data patches (`patches` table, v75), after migrations: shape first, content second.
//
// Never throws. `runMigrations` may stop the boot since nothing can read a malformed database; an
// untransformed content leaves Legion usable. A failed patch is not marked as run, replays at the
// next boot, and is logged below.
const patched = runPatches(sqlite);

export const db = drizzle(sqlite, { schema });
export { schema };

// Control plane trace (v20, 20/08). Decisions that matter (boot, migration, seed, preflight
// refusal, queueing, orphan recovery, integration failure) used to vanish with the terminal.
// `logControlEvent` is the only writer of `control_events`: level, short source, message, optional
// JSON payload.
//
// Here because db.ts itself logs during boot, and a separate module importing `db` would cycle.
// Other domains import it from `events/control-log-store.ts` (11/09), which re-exports it.
export type ControlLevel = "info" | "warn" | "error";

/** Keep the last 5 000 events: plenty for one operator, negligible on disk. */
export const CONTROL_EVENTS_RETENTION = 5000;

export function logControlEvent(
  level: ControlLevel,
  source: string,
  message: string,
  payload?: Record<string, unknown> | null,
): void {
  const inserted = db
    .insert(schema.controlEvents)
    .values({
      level,
      source,
      message,
      payload: payload ? JSON.stringify(payload) : null,
      createdAt: new Date(),
    })
    .run();
  // Rotate by id (indexed primary key), not date: once at the cap, each DELETE touches a handful
  // of rows, no table recount per write.
  const lastId = Number(inserted.lastInsertRowid);
  if (lastId > CONTROL_EVENTS_RETENTION)
    db.delete(schema.controlEvents)
      .where(lte(schema.controlEvents.id, lastId - CONTROL_EVENTS_RETENTION))
      .run();
}

export interface ControlEventRow {
  id: number;
  level: ControlLevel;
  source: string;
  message: string;
  payload: unknown;
  createdAt: number;
}

/** The last N events, newest first, filterable by level. */
export function listControlEvents(
  opts: { level?: ControlLevel; limit?: number } = {},
): ControlEventRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const rows = (
    opts.level
      ? db.select().from(schema.controlEvents).where(eq(schema.controlEvents.level, opts.level))
      : db.select().from(schema.controlEvents)
  )
    .orderBy(desc(schema.controlEvents.id))
    .limit(limit)
    .all();
  return rows.map((r) => ({
    id: r.id,
    level: r.level as ControlLevel,
    source: r.source,
    message: r.message,
    payload: r.payload ? (JSON.parse(r.payload) as unknown) : null,
    createdAt: r.createdAt.getTime(),
  }));
}

// One control event per boot that advanced the schema, not one per migration. After the functions
// above: on a fresh database `control_events` was just created in this boot.
if (migrated.to > migrated.from)
  logControlEvent("info", "db", `migrations applied at boot: v${migrated.from} → v${migrated.to}`, {
    from: migrated.from,
    to: migrated.to,
  });

// One line per boot that ran patches, not per patch. Failures are `error`, not `warn`: a failed
// patch is work left to do.
if (patched.ran.length > 0)
  logControlEvent("info", "db", `data patches applied: ${patched.ran.join(", ")}`, {
    ran: patched.ran,
  });
if (patched.failed.length > 0)
  logControlEvent(
    "error",
    "db",
    `data patches failed (replayed at the next boot): ${patched.failed
      .map((f) => f.id)
      .join(", ")}`,
    { failed: patched.failed },
  );

/** Demo project (v15): a read-only sandbox where no agent runs. Checked by launch points and
 *  automatic selection (queue, scheduler). */
export function isDemoProject(projectId: string): boolean {
  return Boolean(
    db
      .select({ demo: schema.projects.demo })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get()?.demo,
  );
}
