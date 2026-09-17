// Queries for waiting between tasks; `wait-for-task.ts` holds the graph, cycle detection and the
// wake-up text.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { ACTIVITY_FROM } from "../tasks/activity-enums.js";

export type SessionRow = typeof schema.sessions.$inferSelect;
export type TaskRow = typeof schema.tasks.$inferSelect;
export type InboxMessageRow = typeof schema.inboxMessages.$inferSelect;
export type TaskActivityRow = typeof schema.taskActivity.$inferSelect;

export function sessionRow(sessionId: string): SessionRow | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
}

export function taskRow(taskId: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

export function taskRowsByIds(taskIds: readonly string[]): TaskRow[] {
  if (taskIds.length === 0) return [];
  return db
    .select()
    .from(schema.tasks)
    .where(inArray(schema.tasks.id, [...taskIds]))
    .all();
}

/** Every open wait, whatever the target. */
export function openWaitRows(): InboxMessageRow[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(eq(schema.inboxMessages.status, "open"), isNotNull(schema.inboxMessages.waitForTaskId)),
    )
    .all();
}

/** The whole blockers table, raw: the graph wants every edge, not one task's blockers. */
export function allTaskBlockers(): { taskId: string; blockerId: string }[] {
  return db
    .select({ taskId: schema.taskBlockers.taskId, blockerId: schema.taskBlockers.blockerId })
    .from(schema.taskBlockers)
    .all();
}

/** This session's open wait, if any. */
export function openWaitOfSession(sessionId: string): InboxMessageRow | undefined {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(
        eq(schema.inboxMessages.sessionId, sessionId),
        eq(schema.inboxMessages.status, "open"),
        isNotNull(schema.inboxMessages.waitForTaskId),
      ),
    )
    .get();
}

export function openWaitsOnTask(targetTaskId: string): InboxMessageRow[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(
        eq(schema.inboxMessages.waitForTaskId, targetTaskId),
        eq(schema.inboxMessages.status, "open"),
      ),
    )
    .all();
}

/** `inArray` on an empty list produces invalid SQL, hence the short-circuit. */
export function openWaitsOnTasks(targetTaskIds: readonly string[]): InboxMessageRow[] {
  if (targetTaskIds.length === 0) return [];
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(
        inArray(schema.inboxMessages.waitForTaskId, [...targetTaskIds]),
        eq(schema.inboxMessages.status, "open"),
      ),
    )
    .all();
}

export function closeInboxMessage(inboxId: string): void {
  db.update(schema.inboxMessages)
    .set({ status: "closed" })
    .where(eq(schema.inboxMessages.id, inboxId))
    .run();
}

/** In database order: sorting and picking the last useful note are the caller's rule. */
export function taskActivityOf(taskId: string): TaskActivityRow[] {
  return db.select().from(schema.taskActivity).where(eq(schema.taskActivity.taskId, taskId)).all();
}

/** A system line in the waiting task's activity thread. */
export function insertSystemNote(id: string, taskId: string, body: string, createdAt: Date): void {
  db.insert(schema.taskActivity)
    .values({ id, taskId, from: ACTIVITY_FROM.system, body, createdAt })
    .run();
}
