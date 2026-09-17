// The raw rows behind a task's lineage: the task, its children (newest first), and the agents it
// names. No business `if` here: assembling a `TaskLink` (resolved agent, derived `blocksParent`)
// stays in `task-links.ts`.
import { desc, and, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type TaskRow = typeof schema.tasks.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;

export function taskRowById(id: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
}

export function agentRowById(id: string): AgentRow | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
}

export function agentRowByProjectAndName(projectId: string, name: string): AgentRow | undefined {
  return db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, name)))
    .get();
}

/** A task's children, newest first. Archived ones stay in the result: see `task-links.ts` for why
 *  (an archived task still spawned the next one). */
export function childrenOf(taskId: string): TaskRow[] {
  return db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.proposedFromTaskId, taskId))
    .orderBy(desc(schema.tasks.createdAt))
    .all();
}
