// Queries for session workspaces; the rule deciding which files may go (`workspacesToRelease`)
// lives in `workspace.ts`.
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export type SessionRow = typeof schema.sessions.$inferSelect;
export type RunnerRow = typeof schema.runners.$inferSelect;

export function sessionStatusesOfTask(taskId: string): { id: string; status: string }[] {
  return db
    .select({ id: schema.sessions.id, status: schema.sessions.status })
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .all();
}

export function sessionRowsByIds(sessionIds: readonly string[]): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(inArray(schema.sessions.id, [...sessionIds]))
    .all();
}

export function taskStatusesByIds(taskIds: readonly string[]): Map<string, string> {
  if (taskIds.length === 0) return new Map();
  return new Map(
    db
      .select()
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, [...taskIds]))
      .all()
      .map((t) => [t.id, t.status as string]),
  );
}

/** The mount-mode filter is the caller's rule. */
export function allRunners(): RunnerRow[] {
  return db.select().from(schema.runners).all();
}
