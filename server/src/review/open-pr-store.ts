// Queries only; the rule (pushed repositories, last commit wins, idempotent PR) is in `open-pr.ts`.
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SessionEventRow = typeof schema.sessionEvents.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;

/** Session events that may carry a `repo_push`, sorted by id: that is write order, so the last one
 *  is the latest. */
export function pushEventsOf(sessionIds: readonly string[]): SessionEventRow[] {
  if (sessionIds.length === 0) return [];
  return db
    .select()
    .from(schema.sessionEvents)
    .where(inArray(schema.sessionEvents.sessionId, [...sessionIds]))
    .orderBy(schema.sessionEvents.id)
    .all();
}

export function sessionIdsOfTask(taskId: string): string[] {
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .all()
    .map((s) => s.id);
}

export function sessionsOfTask(taskId: string): SessionRow[] {
  return db.select().from(schema.sessions).where(eq(schema.sessions.taskId, taskId)).all();
}

export function sessionRow(sessionId: string): SessionRow | null {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get() ?? null;
}

export function mergeTaskPrUrls(taskId: string, prUrls: string): void {
  db.update(schema.tasks)
    .set({ prUrls, updatedAt: new Date() })
    .where(eq(schema.tasks.id, taskId))
    .run();
}
