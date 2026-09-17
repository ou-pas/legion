// The tasks domain's raw reads, what the routes used to ask `db` directly (06/09).
//
// Six questions, each for a specific caller: the board (`allTaskRows`, `allSessionRows`,
// `demoProjectIds`), one task's record (`findTask`), its activity log (`taskActivity`) and the
// agent classifier (`classifyAgentsOf`, batch 13 M5, so `task-classify.ts` stays database-free).
// The most mundane one, "does the task exist?", used to be rewritten five times in the routes, each
// with the same `!` to convince the compiler. A named function returns `undefined` instead, and the
// 404 becomes a two-word `if`.
//
// Reads only: what mutates a task has its own module with its guards. No business `if` either:
// which projection the board gets (summaries, not records) is the caller's decision
// (`tasks/routes/crud.ts`, composing these reads with `serializeTaskSummaries`).
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import type { ClassifyAgent } from "./task-classify.js";

type TaskRow = typeof schema.tasks.$inferSelect;
type SessionRow = typeof schema.sessions.$inferSelect;
type ActivityRow = typeof schema.taskActivity.$inferSelect;

/** The task, or `undefined`: the 404 belongs to the caller, who alone knows how to word it. */
export function findTask(taskId: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

/** All tasks, newest first, archived included (`archived` flag): the board filters client-side, but
 *  a task or goal page must be able to show an archived task (review 5b #2). */
export function allTaskRows(): TaskRow[] {
  return db.select().from(schema.tasks).orderBy(desc(schema.tasks.createdAt)).all();
}

export function allSessionRows(): SessionRow[] {
  return db.select().from(schema.sessions).orderBy(desc(schema.sessions.startedAt)).all();
}

/** Demo project ids: what `serializeTaskSummaries` needs to flag a task as such. */
export function demoProjectIds(): Set<string> {
  return new Set(
    db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.demo, true))
      .all()
      .map((p) => p.id),
  );
}

/** A task's activity log, in write order. Empty for an unknown task: an ancillary view, not proof
 *  of existence. */
export function taskActivity(taskId: string): ActivityRow[] {
  return db.select().from(schema.taskActivity).where(eq(schema.taskActivity.taskId, taskId)).all();
}

/** The project's agents, reduced to what the classifier reads (`task-classify.ts` does not touch the
 *  database: its world is passed in, which makes it testable without SQLite). */
export function classifyAgentsOf(projectId: string): ClassifyAgent[] {
  return db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId))
    .all()
    .map((a) => ({ id: a.id, name: a.name, title: a.title, rolePrompt: a.rolePrompt }));
}
