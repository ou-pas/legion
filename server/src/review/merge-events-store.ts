// Queries only; decisions live in `merge-events.ts`.
import { and, desc, eq, like } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";

export type TaskRow = typeof schema.tasks.$inferSelect;
export type TaskActivityRow = typeof schema.taskActivity.$inferSelect;
export type ControlEventRow = typeof schema.controlEvents.$inferSelect;
export type NewTaskActivity = typeof schema.taskActivity.$inferInsert;

/** Control log events (source `webhooks`) whose message mentions this task id, newest first. The
 *  exact filter (strict equality on `taskId` in the payload) is the caller's rule; this `LIKE` is
 *  only a coarse SQL filter. */
export function controlEventsMentioning(taskId: string): ControlEventRow[] {
  return db
    .select()
    .from(schema.controlEvents)
    .where(
      and(
        eq(schema.controlEvents.source, "webhooks"),
        like(schema.controlEvents.message, `%${taskId}%`),
      ),
    )
    .orderBy(desc(schema.controlEvents.id))
    .all();
}

export function tasksInReview(): TaskRow[] {
  return db.select().from(schema.tasks).where(eq(schema.tasks.status, TASK_STATUS.review)).all();
}

export function taskActivityOf(taskId: string): TaskActivityRow[] {
  return db.select().from(schema.taskActivity).where(eq(schema.taskActivity.taskId, taskId)).all();
}

export function insertTaskActivity(row: NewTaskActivity): void {
  db.insert(schema.taskActivity).values(row).run();
}
