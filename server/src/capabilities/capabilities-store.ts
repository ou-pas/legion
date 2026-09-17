// Database access for `capabilities.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type RuleRow = typeof schema.rules.$inferSelect;

export function getProject(projectId: string): typeof schema.projects.$inferSelect | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
}

export function setProjectContext(projectId: string, context: string): void {
  db.update(schema.projects).set({ context }).where(eq(schema.projects.id, projectId)).run();
}

export function rulesOfProject(projectId: string): RuleRow[] {
  return db.select().from(schema.rules).where(eq(schema.rules.projectId, projectId)).all();
}

export function insertRule(row: typeof schema.rules.$inferInsert): void {
  db.insert(schema.rules).values(row).run();
}

export function mcpServersOfProject(projectId: string): (typeof schema.mcpServers.$inferSelect)[] {
  return db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.projectId, projectId))
    .all();
}

export function secretsOfProject(projectId: string): (typeof schema.secrets.$inferSelect)[] {
  return db.select().from(schema.secrets).where(eq(schema.secrets.projectId, projectId)).all();
}
