// Queries for the out-of-quota pause; the rules live in `quota-pause.ts` (reading the rejection)
// and `quota-plan.ts` (the plan).
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SessionEventRow = typeof schema.sessionEvents.$inferSelect;
export type InboxMessageRow = typeof schema.inboxMessages.$inferSelect;

/** In insertion order. Scoping to the current run is the caller's rule. */
export function throttleEventsOf(sessionId: string): SessionEventRow[] {
  return db
    .select()
    .from(schema.sessionEvents)
    .where(
      and(eq(schema.sessionEvents.sessionId, sessionId), eq(schema.sessionEvents.type, "throttle")),
    )
    .all();
}

/** Which account and project THIS run uses, `undefined` if the session is gone. */
export function runAccountOf(
  sessionId: string,
): { credentialId: string | null; projectId: string } | undefined {
  return db
    .select({ credentialId: schema.sessions.credentialId, projectId: schema.tasks.projectId })
    .from(schema.sessions)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.sessions.taskId))
    .where(eq(schema.sessions.id, sessionId))
    .get();
}

/** Comparing the wake-up time with now is the caller's rule. */
export function openInboxWakeups(): InboxMessageRow[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(and(eq(schema.inboxMessages.status, "open"), isNotNull(schema.inboxMessages.wakeAt)))
    .all();
}
