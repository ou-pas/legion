// Queries for seeding the Legion project itself; content and upsert decisions live in `self.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export type ProjectRow = typeof schema.projects.$inferSelect;
export type EnvironmentRow = typeof schema.environments.$inferSelect;
export type RepoRow = typeof schema.repos.$inferSelect;
export type RuleRow = typeof schema.rules.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;

export function projectRowBySlug(slug: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.slug, slug)).get();
}

export function updateProjectRow(
  id: string,
  patch: Partial<typeof schema.projects.$inferInsert>,
): void {
  db.update(schema.projects).set(patch).where(eq(schema.projects.id, id)).run();
}

export function insertProjectRow(row: typeof schema.projects.$inferInsert): void {
  db.insert(schema.projects).values(row).run();
}

export function environmentRowByName(projectId: string, name: string): EnvironmentRow | undefined {
  return db
    .select()
    .from(schema.environments)
    .where(and(eq(schema.environments.projectId, projectId), eq(schema.environments.name, name)))
    .get();
}

export function updateEnvironmentRow(
  id: string,
  patch: Partial<typeof schema.environments.$inferInsert>,
): void {
  db.update(schema.environments).set(patch).where(eq(schema.environments.id, id)).run();
}

export function insertEnvironmentRow(row: typeof schema.environments.$inferInsert): void {
  db.insert(schema.environments).values(row).run();
}

export function repoRowByName(projectId: string, name: string): RepoRow | undefined {
  return db
    .select()
    .from(schema.repos)
    .where(and(eq(schema.repos.projectId, projectId), eq(schema.repos.name, name)))
    .get();
}

export function updateRepoRow(id: string, patch: Partial<typeof schema.repos.$inferInsert>): void {
  db.update(schema.repos).set(patch).where(eq(schema.repos.id, id)).run();
}

export function insertRepoRow(row: typeof schema.repos.$inferInsert): void {
  db.insert(schema.repos).values(row).run();
}

export function ruleRowByName(projectId: string, name: string): RuleRow | undefined {
  return db
    .select()
    .from(schema.rules)
    .where(and(eq(schema.rules.projectId, projectId), eq(schema.rules.name, name)))
    .get();
}

export function updateRuleRow(id: string, patch: Partial<typeof schema.rules.$inferInsert>): void {
  db.update(schema.rules).set(patch).where(eq(schema.rules.id, id)).run();
}

export function insertRuleRow(row: typeof schema.rules.$inferInsert): void {
  db.insert(schema.rules).values(row).run();
}

export function agentRowByName(projectId: string, name: string): AgentRow | undefined {
  return db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.projectId, projectId), eq(schema.agents.name, name)))
    .get();
}

export function updateAgentRow(
  id: string,
  patch: Partial<typeof schema.agents.$inferInsert>,
): void {
  db.update(schema.agents).set(patch).where(eq(schema.agents.id, id)).run();
}

export function insertAgentRow(row: typeof schema.agents.$inferInsert): void {
  db.insert(schema.agents).values(row).run();
}

export function agentNamesOfProject(projectId: string): string[] {
  return db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId))
    .all()
    .map((a) => a.name);
}
