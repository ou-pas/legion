// Goal loop queries, each named by the fact it writes.
//
// Most decide nothing: what leads to a pause, what counts as progress and what charges a cost stay
// in `goals.ts`. Three exceptions, documented on the function: `averageSessionCostUsd` chooses which
// sessions count (those that cost something); `startGoal` writes `dodApproved: true` because a goal
// only starts through human approval of its DoD; `resumeGoalRow` resets `noProgressStreak` because
// resuming is the event that clears the previous stall. `isDemoProject` is re-exported so the loop
// never touches `shared/db.js`.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";
import { GOAL_STATUS } from "./goal-status.js";

export { isDemoProject };

export type GoalRow = typeof schema.goals.$inferSelect;
export type GoalEventRow = typeof schema.goalEvents.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;
export type TaskRow = typeof schema.tasks.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;
export type ProjectRow = typeof schema.projects.$inferSelect;
export type TaskActivityRow = typeof schema.taskActivity.$inferSelect;
export type NewTask = typeof schema.tasks.$inferInsert;

export function goalRow(id: string): GoalRow | undefined {
  return db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
}

export function goalRowsOf(projectId?: string): GoalRow[] {
  return projectId
    ? db.select().from(schema.goals).where(eq(schema.goals.projectId, projectId)).all()
    : db.select().from(schema.goals).all();
}

export function activeGoalRows(): GoalRow[] {
  return db.select().from(schema.goals).where(eq(schema.goals.status, GOAL_STATUS.active)).all();
}

/** The goal's log, in write order. Keeping only the last twelve is a context rule, not a query. */
export function goalEventRows(goalId: string): GoalEventRow[] {
  return db.select().from(schema.goalEvents).where(eq(schema.goalEvents.goalId, goalId)).all();
}

export function agentRowsOf(projectId: string): AgentRow[] {
  return db.select().from(schema.agents).where(eq(schema.agents.projectId, projectId)).all();
}

export function projectRow(projectId: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
}

export function taskRowsOfGoal(goalId: string): TaskRow[] {
  return db.select().from(schema.tasks).where(eq(schema.tasks.goalId, goalId)).all();
}

export function taskRowsById(ids: readonly string[]): TaskRow[] {
  return db
    .select()
    .from(schema.tasks)
    .where(inArray(schema.tasks.id, [...ids]))
    .all();
}

export function sessionRowsOfTasks(taskIds: readonly string[]): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(inArray(schema.sessions.taskId, [...taskIds]))
    .all();
}

export function taskActivityOfTasks(taskIds: readonly string[]): TaskActivityRow[] {
  return db
    .select()
    .from(schema.taskActivity)
    .where(inArray(schema.taskActivity.taskId, [...taskIds]))
    .all();
}

/** Sessions in one of these statuses among the given tasks, e.g. the live sessions a `kill` must
 *  stop. The status choice is the caller's rule (see `killGoal` in `goals.ts`, which deliberately
 *  excludes `committing`). */
export function sessionsOfTasksInStatus(
  taskIds: readonly string[],
  statuses: readonly SessionRow["status"][],
): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(
        inArray(schema.sessions.taskId, [...taskIds]),
        inArray(schema.sessions.status, [...statuses]),
      ),
    )
    .all();
}

/** The average cost of a session that cost something, `null` if there is none. The fallback value
 *  is the caller's. */
export function averageSessionCostUsd(): number | null {
  const row = db
    .select({ avg: sql<number | null>`avg(${schema.sessions.costUsd})` })
    .from(schema.sessions)
    .where(gt(schema.sessions.costUsd, 0))
    .get();
  return row?.avg ?? null;
}

export function insertGoalEvent(goalId: string, type: string, payload: string): void {
  db.insert(schema.goalEvents).values({ goalId, type, payload, createdAt: new Date() }).run();
}

export function saveDodAndPlan(goalId: string, dod: string, plan: string): void {
  db.update(schema.goals).set({ dod, plan }).where(eq(schema.goals.id, goalId)).run();
}

/** Human approval, and nothing else, starts a goal. */
export function startGoal(goalId: string, dod: string, mock: boolean, startedAt: Date): void {
  db.update(schema.goals)
    .set({ dod, dodApproved: true, status: GOAL_STATUS.active, startedAt, mock })
    .where(eq(schema.goals.id, goalId))
    .run();
}

export function setGoalStatus(goalId: string, status: string): void {
  db.update(schema.goals)
    .set({ status: status as GoalRow["status"] })
    .where(eq(schema.goals.id, goalId))
    .run();
}

export function endGoalRow(goalId: string, status: string, endedAt: Date): void {
  db.update(schema.goals)
    .set({ status: status as GoalRow["status"], endedAt })
    .where(eq(schema.goals.id, goalId))
    .run();
}

/** Resuming resets the stall counter: a fact of resuming, not of the state. */
export function resumeGoalRow(goalId: string): void {
  db.update(schema.goals)
    .set({ status: GOAL_STATUS.active, noProgressStreak: 0 })
    .where(eq(schema.goals.id, goalId))
    .run();
}

export function saveDecision(
  goalId: string,
  fields: { dod: string; iterations: number; noProgressStreak: number },
): void {
  db.update(schema.goals).set(fields).where(eq(schema.goals.id, goalId)).run();
}

export function setNoProgressStreak(goalId: string, noProgressStreak: number): void {
  db.update(schema.goals).set({ noProgressStreak }).where(eq(schema.goals.id, goalId)).run();
}

export function saveLotOutcome(goalId: string, fields: { spentUsd: number; dod: string }): void {
  db.update(schema.goals).set(fields).where(eq(schema.goals.id, goalId)).run();
}

export function insertGoalTask(row: NewTask): void {
  db.insert(schema.tasks).values(row).run();
}

/** Removes a task row that never started: without it, a capacity refusal would leave an orphan task
 *  on the Board. */
export function deleteTaskRow(taskId: string): void {
  db.delete(schema.tasks).where(eq(schema.tasks.id, taskId)).run();
}
