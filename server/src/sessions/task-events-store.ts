// Queries for a task's trace; `task-events.ts` shapes the rows for the UI.
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SessionRow = typeof schema.sessions.$inferSelect;
export type SessionEventRow = typeof schema.sessionEvents.$inferSelect;

/** Oldest first. */
export function sessionRowsOfTask(taskId: string): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .orderBy(asc(schema.sessions.startedAt))
    .all();
}

/** In insertion order. `afterDbId > 0` returns only what follows, which is what the page rereads
 *  on every tick. */
export function eventRowsOfSessions(
  sessionIds: readonly string[],
  afterDbId: number,
): SessionEventRow[] {
  const inSessions = inArray(schema.sessionEvents.sessionId, [...sessionIds]);
  const scope =
    afterDbId > 0 ? and(inSessions, gt(schema.sessionEvents.id, afterDbId)) : inSessions;
  return db
    .select()
    .from(schema.sessionEvents)
    .where(scope)
    .orderBy(asc(schema.sessionEvents.id))
    .all();
}
