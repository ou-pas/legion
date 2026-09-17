// Queries only. Refusing a live goal, the demo-project exemption, and a task outside the goal being
// "unblocked" only when all its remaining blockers belonged to the goal are rules in
// `goal-delete.ts`. Here we count and erase. `isDemoProject` is re-exported so that file never
// touches `shared/db.js`.
import { and, eq, inArray } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";
import { LIVE } from "../projects/purge.js";

export { isDemoProject };

export type GoalRow = typeof schema.goals.$inferSelect;
export type ProjectRow = typeof schema.projects.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;
export type TaskNameRow = { id: string; name: string };

export function goalRow(goalId: string): GoalRow | undefined {
  return db.select().from(schema.goals).where(eq(schema.goals.id, goalId)).get();
}

export function projectRow(projectId: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
}

export function goalTaskIds(goalId: string): string[] {
  return db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.goalId, goalId))
    .all()
    .map((t) => t.id);
}

export function goalTaskNames(goalId: string): TaskNameRow[] {
  return db
    .select({ id: schema.tasks.id, name: schema.tasks.name })
    .from(schema.tasks)
    .where(eq(schema.tasks.goalId, goalId))
    .all();
}

export function taskNamesById(ids: readonly string[]): TaskNameRow[] {
  return db
    .select({ id: schema.tasks.id, name: schema.tasks.name })
    .from(schema.tasks)
    .where(inArray(schema.tasks.id, [...ids]))
    .all();
}

export function sessionIdsOfTasks(taskIds: readonly string[]): string[] {
  if (taskIds.length === 0) return [];
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(inArray(schema.sessions.taskId, [...taskIds]))
    .all()
    .map((s) => s.id);
}

/** Live sessions of the given tasks. `LIVE` comes from `purge.ts`, which derives it from
 *  `ACTIVE_STATUSES`: no private copy of the live status list. */
export function liveSessionsOfTasks(taskIds: readonly string[]): SessionRow[] {
  if (taskIds.length === 0) return [];
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(
        inArray(schema.sessions.taskId, [...taskIds]),
        inArray(schema.sessions.status, [...LIVE]),
      ),
    )
    .all();
}

export function countSessionEvents(sessionIds: readonly string[]): number {
  if (sessionIds.length === 0) return 0;
  return db
    .select({ id: schema.sessionEvents.id })
    .from(schema.sessionEvents)
    .where(inArray(schema.sessionEvents.sessionId, [...sessionIds]))
    .all().length;
}

export function countInboxMessages(taskIds: readonly string[]): number {
  if (taskIds.length === 0) return 0;
  return db
    .select({ id: schema.inboxMessages.id })
    .from(schema.inboxMessages)
    .where(inArray(schema.inboxMessages.taskId, [...taskIds]))
    .all().length;
}

export function countReviewComments(taskIds: readonly string[]): number {
  if (taskIds.length === 0) return 0;
  return db
    .select({ id: schema.reviewComments.id })
    .from(schema.reviewComments)
    .where(inArray(schema.reviewComments.taskId, [...taskIds]))
    .all().length;
}

export function countTaskActivity(taskIds: readonly string[]): number {
  if (taskIds.length === 0) return 0;
  return db
    .select({ id: schema.taskActivity.id })
    .from(schema.taskActivity)
    .where(inArray(schema.taskActivity.taskId, [...taskIds]))
    .all().length;
}

export function countGoalEvents(goalId: string): number {
  return db
    .select({ id: schema.goalEvents.id })
    .from(schema.goalEvents)
    .where(eq(schema.goalEvents.goalId, goalId))
    .all().length;
}

/** Tasks blocked by any of these tasks. */
export function blockedByAnyOf(blockerIds: readonly string[]): string[] {
  return db
    .select({ taskId: schema.taskBlockers.taskId })
    .from(schema.taskBlockers)
    .where(inArray(schema.taskBlockers.blockerId, [...blockerIds]))
    .all()
    .map((r) => r.taskId);
}

/** Every blocker link holding these tasks, blocker included: the caller judges whether the blocker
 *  belonged to the goal. */
export function blockerLinksOf(
  taskIds: readonly string[],
): { taskId: string; blockerId: string }[] {
  return db
    .select()
    .from(schema.taskBlockers)
    .where(inArray(schema.taskBlockers.taskId, [...taskIds]))
    .all();
}

export function inGoalDeletionTransaction(erase: () => void): void {
  db.transaction(erase);
}

/** `goal_events` before `goals`: the FK has no `ON DELETE`, the reverse order throws. */
export function deleteGoalRow(goalId: string): void {
  db.delete(schema.goalEvents).where(eq(schema.goalEvents.goalId, goalId)).run();
  db.delete(schema.goals).where(eq(schema.goals.id, goalId)).run();
}
