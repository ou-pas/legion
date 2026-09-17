// Infra overview store: the raw queries `sessionJoin` (infra.ts) combines to link a container to
// its task and goal.
import { inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import type { SessionStatus } from "../sessions/session-terminal.js";

export function sessionsByIds(sessionIds: string[]): (typeof schema.sessions.$inferSelect)[] {
  return sessionIds.length
    ? db.select().from(schema.sessions).where(inArray(schema.sessions.id, sessionIds)).all()
    : [];
}

/** Zombies (`RUNTIME_STATES`) and dev fixtures (`ACTIVE_SESSION_STATES`) ask with different lists. */
export function sessionsInStates(
  statuses: readonly SessionStatus[],
): (typeof schema.sessions.$inferSelect)[] {
  return db
    .select()
    .from(schema.sessions)
    .where(inArray(schema.sessions.status, [...statuses]))
    .all();
}

export function tasksByIds(taskIds: string[]): (typeof schema.tasks.$inferSelect)[] {
  return taskIds.length
    ? db.select().from(schema.tasks).where(inArray(schema.tasks.id, taskIds)).all()
    : [];
}
