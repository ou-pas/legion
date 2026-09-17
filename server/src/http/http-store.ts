// Queries of the HTTP shell; nothing is decided here (see `app.ts` and `lookup.ts`). Both reads
// (`/api/bootstrap` and `/api/lookup/:id`) cross four domains and belong to none.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type ProjectRow = typeof schema.projects.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;
export type RunnerRow = typeof schema.runners.$inferSelect;
export type TaskTemplateRow = typeof schema.taskTemplates.$inferSelect;
export type TaskRow = typeof schema.tasks.$inferSelect;
export type GoalRow = typeof schema.goals.$inferSelect;

export function allProjects(): ProjectRow[] {
  return db.select().from(schema.projects).all();
}

export function allAgents(): AgentRow[] {
  return db.select().from(schema.agents).all();
}

export function allRunners(): RunnerRow[] {
  return db.select().from(schema.runners).all();
}

/** Raw templates: steps are JSON in the database, the caller parses them. */
export function allTaskTemplates(): TaskTemplateRow[] {
  return db.select().from(schema.taskTemplates).all();
}

// Four separate reads, not a join: the order they are tried in is `lookupId`'s rule.

export function taskRow(id: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
}

export function goalRow(id: string): GoalRow | undefined {
  return db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
}

export function agentRow(id: string): AgentRow | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
}

export function projectRow(id: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}
