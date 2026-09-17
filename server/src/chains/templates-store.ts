// The status that releases a dependent task, session order and chain refusals are decided in
// `templates.ts`, which receives the rows.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import type { TaskStatus } from "../tasks/lifecycle.js";

type TaskRow = typeof schema.tasks.$inferSelect;
type TaskTemplateRow = typeof schema.taskTemplates.$inferSelect;
type AgentRow = typeof schema.agents.$inferSelect;
type SessionRow = typeof schema.sessions.$inferSelect;

/** The handle writers insert through, structural like the one in `blockers-store.ts`: bare `db`
 *  and the Drizzle transaction inherit `insert` from the same parent. */
export type ChainWriter = Pick<typeof db, "insert">;

export function chainTemplateById(id: string): TaskTemplateRow | undefined {
  return db.select().from(schema.taskTemplates).where(eq(schema.taskTemplates.id, id)).get();
}

export function taskById(id: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
}

export function agentsOfProject(projectId: string): AgentRow[] {
  return db.select().from(schema.agents).where(eq(schema.agents.projectId, projectId)).all();
}

/** The project's "chain role → agent" mapping as stored (JSON, or `null` when the project does not
 *  exist): `templates.ts` decides what to do with unreadable text. */
export function projectChainBindings(projectId: string): string | null {
  return (
    db
      .select({ chainBindings: schema.projects.chainBindings })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get()?.chainBindings ?? null
  );
}

export function projectPaths(
  projectId: string,
): { slug: string; fsRoot: string | null } | undefined {
  return db
    .select({ slug: schema.projects.slug, fsRoot: schema.projects.fsRoot })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
}

/** All or nothing, so no orphan step if the loop throws midway. `tx` is handed to the caller so the
 *  links from `blockers-store.ts` land in it by construction. */
export function inChainTransaction<T>(fn: (tx: ChainWriter) => T): T {
  return db.transaction((tx) => fn(tx));
}

export function insertStepTask(tx: ChainWriter, row: typeof schema.tasks.$inferInsert): void {
  tx.insert(schema.tasks).values(row).run();
}

/** Settling a done. It becomes a savepoint when the caller is already in a transaction
 *  (better-sqlite3 nests), see `settleDone`. */
export function inSettleTransaction<T>(fn: () => T): T {
  return db.transaction(fn);
}

export function sessionsOfTask(taskId: string): SessionRow[] {
  return db.select().from(schema.sessions).where(eq(schema.sessions.taskId, taskId)).all();
}

export function activityBodiesOfTask(taskId: string): string[] {
  return db
    .select({ body: schema.taskActivity.body })
    .from(schema.taskActivity)
    .where(eq(schema.taskActivity.taskId, taskId))
    .all()
    .map((a) => a.body);
}

/** The status comes from `templates.ts`, which knows only a `todo` dependent starts. */
export function tasksAmongInStatus(ids: readonly string[], status: TaskStatus): TaskRow[] {
  return db
    .select()
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.id, [...ids]), eq(schema.tasks.status, status)))
    .all();
}

/** Sorting, due dates and demo projects are the tick's business (see `startScheduler`). */
export function tasksInStatus(status: TaskStatus): TaskRow[] {
  return db.select().from(schema.tasks).where(eq(schema.tasks.status, status)).all();
}

/** The demo project starts nothing on its own. The query lives in `shared/db.ts` and is relayed
 *  here so `templates.ts` does not import it from the database. */
export { isDemoProject } from "../shared/db.js";

export function clearSchedule(taskId: string, now: Date): void {
  db.update(schema.tasks)
    .set({ scheduledAt: null, updatedAt: now })
    .where(eq(schema.tasks.id, taskId))
    .run();
}
