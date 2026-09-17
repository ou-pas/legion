// Queries for `environments.ts`. Name casing, the open status, collisions and delete refusals are
// decided there.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type EnvironmentRow = typeof schema.environments.$inferSelect;
export type EnvironmentInsert = typeof schema.environments.$inferInsert;

export function environmentRowsOf(projectId?: string): EnvironmentRow[] {
  return projectId
    ? db
        .select()
        .from(schema.environments)
        .where(eq(schema.environments.projectId, projectId))
        .all()
    : db.select().from(schema.environments).all();
}

export function environmentRow(id: string): EnvironmentRow | undefined {
  return db.select().from(schema.environments).where(eq(schema.environments.id, id)).get();
}

export function projectRow(id: string): typeof schema.projects.$inferSelect | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

export function agentNamesUsing(environmentId: string): string[] {
  return db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.environmentId, environmentId))
    .all()
    .map((a) => a.name);
}

export function insertEnvironment(row: EnvironmentInsert): void {
  db.insert(schema.environments).values(row).run();
}

export function updateEnvironment(id: string, patch: Partial<EnvironmentInsert>): void {
  db.update(schema.environments).set(patch).where(eq(schema.environments.id, id)).run();
}

export function deleteEnvironmentRow(id: string): void {
  db.delete(schema.environments).where(eq(schema.environments.id, id)).run();
}
