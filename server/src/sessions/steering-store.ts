// Queries for live steering; the rules live in `steering.ts`.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SteerRow = typeof schema.sessionSteers.$inferSelect;

export function insertSteer(row: SteerRow): void {
  db.insert(schema.sessionSteers).values(row).run();
}

/** Oldest first. */
export function undeliveredSteersOf(sessionId: string): SteerRow[] {
  return db
    .select()
    .from(schema.sessionSteers)
    .where(
      and(eq(schema.sessionSteers.sessionId, sessionId), isNull(schema.sessionSteers.deliveredAt)),
    )
    .orderBy(asc(schema.sessionSteers.createdAt))
    .all();
}

export function markSteerDelivered(steerId: string, deliveredAt: Date): void {
  db.update(schema.sessionSteers)
    .set({ deliveredAt })
    .where(eq(schema.sessionSteers.id, steerId))
    .run();
}

/** HUMAN messages across all sessions of a task, chronologically, joined through `sessionId` since
 *  the table has no `taskId`. `rowid` breaks millisecond ties (same defect, same fix as
 *  `inbox-history.ts`) and is table-qualified: in a join a bare `rowid` is ambiguous. */
export function humanSteerRowsForTask(taskId: string): { text: string; createdAt: Date }[] {
  return db
    .select({ text: schema.sessionSteers.text, createdAt: schema.sessionSteers.createdAt })
    .from(schema.sessionSteers)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionSteers.sessionId))
    .where(and(eq(schema.sessions.taskId, taskId), eq(schema.sessionSteers.source, "human")))
    .orderBy(asc(schema.sessionSteers.createdAt), asc(sql`session_steers.rowid`))
    .all();
}
