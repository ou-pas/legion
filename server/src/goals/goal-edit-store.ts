// Queries only; which fields stay editable at which status, what a rewritten request invalidates
// and what a failed DoD regeneration still leaves in place are decided in `goal-edit.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type GoalRow = typeof schema.goals.$inferSelect;

export function goalRow(goalId: string): GoalRow | undefined {
  return db.select().from(schema.goals).where(eq(schema.goals.id, goalId)).get();
}

export function agentIdsOf(projectId: string): string[] {
  return db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId))
    .all()
    .map((a) => a.id);
}

/** Writes exactly the columns the edit kept; `toColumns` builds that list. */
export function saveGoalEdit(goalId: string, fields: Partial<GoalRow>): void {
  db.update(schema.goals).set(fields).where(eq(schema.goals.id, goalId)).run();
}
