// Export reads. What leaves is decided in `crate-collect.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type ProjectRow = typeof schema.projects.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;
export type EnvironmentRow = typeof schema.environments.$inferSelect;
export type RepoRow = typeof schema.repos.$inferSelect;
export type RuleRow = typeof schema.rules.$inferSelect;
export type McpServerRow = typeof schema.mcpServers.$inferSelect;
export type TaskTemplateRow = typeof schema.taskTemplates.$inferSelect;
export type SecretRow = typeof schema.secrets.$inferSelect;

export function projectRow(projectId: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
}

export function agentRowsOf(projectId: string): AgentRow[] {
  return db.select().from(schema.agents).where(eq(schema.agents.projectId, projectId)).all();
}

export function environmentRowsOf(projectId: string): EnvironmentRow[] {
  return db
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.projectId, projectId))
    .all();
}

export function repoRowsOf(projectId: string): RepoRow[] {
  return db.select().from(schema.repos).where(eq(schema.repos.projectId, projectId)).all();
}

export function ruleRowsOf(projectId: string): RuleRow[] {
  return db.select().from(schema.rules).where(eq(schema.rules.projectId, projectId)).all();
}

export function mcpServerRowsOf(projectId: string): McpServerRow[] {
  return db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.projectId, projectId))
    .all();
}

export function taskTemplateRowsOf(projectId: string): TaskTemplateRow[] {
  return db
    .select()
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.projectId, projectId))
    .all();
}

export function secretRowsOf(projectId: string): SecretRow[] {
  return db.select().from(schema.secrets).where(eq(schema.secrets.projectId, projectId)).all();
}
