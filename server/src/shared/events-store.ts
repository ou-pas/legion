// Queries for the event bus's database trace; decisions stay in `events.ts`.
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "./db.js";

export type SessionEventRow = typeof schema.sessionEvents.$inferSelect;
export type NewSessionEvent = typeof schema.sessionEvents.$inferInsert;

/** The highest stored seq for this session, `null` if it said nothing. */
export function maxSeqOf(sessionId: string): number | null {
  const row = db
    .select({ max: sql<number | null>`max(${schema.sessionEvents.seq})` })
    .from(schema.sessionEvents)
    .where(eq(schema.sessionEvents.sessionId, sessionId))
    .get();
  return row?.max ?? null;
}

/** Inserts the row, or does nothing if (session, seq) exists (the unique index refuses it). A
 *  duplicate returns `changes: 0`, a normal case. */
export function insertSessionEvent(row: NewSessionEvent): {
  changes: number;
  lastInsertRowid: number | bigint;
} {
  const inserted = db.insert(schema.sessionEvents).values(row).onConflictDoNothing().run();
  return { changes: inserted.changes, lastInsertRowid: inserted.lastInsertRowid };
}

export function bumpSessionEventCount(sessionId: string): void {
  db.update(schema.sessions)
    .set({ eventCount: sql`${schema.sessions.eventCount} + 1` })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

/** A session's trace in write order. `afterDbId > 0` returns only what follows. */
export function sessionEventRows(sessionId: string, afterDbId: number): SessionEventRow[] {
  const scope =
    afterDbId > 0
      ? and(eq(schema.sessionEvents.sessionId, sessionId), gt(schema.sessionEvents.id, afterDbId))
      : eq(schema.sessionEvents.sessionId, sessionId);
  return db
    .select()
    .from(schema.sessionEvents)
    .where(scope)
    .orderBy(asc(schema.sessionEvents.id))
    .all();
}
