// Database access for `edit.ts`: the agent, the project tables its grants are checked against,
// its environment, and the final write.
import { eq } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

type AgentRow = typeof schema.agents.$inferSelect;

export function getAgent(agentId: string): AgentRow | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}

export function updateAgent(agentId: string, fields: Partial<AgentRow>): void {
  db.update(schema.agents).set(fields).where(eq(schema.agents.id, agentId)).run();
}

export function repoNamesOfProject(projectId: string): string[] {
  return db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.projectId, projectId))
    .all()
    .map((r) => r.name);
}

export function ruleIdsOfProject(projectId: string): string[] {
  return db
    .select()
    .from(schema.rules)
    .where(eq(schema.rules.projectId, projectId))
    .all()
    .map((r) => r.id);
}

export function secretNamesOfProject(projectId: string): string[] {
  return db
    .select()
    .from(schema.secrets)
    .where(eq(schema.secrets.projectId, projectId))
    .all()
    .map((s) => s.name);
}

export function mcpServerIdsOfProject(projectId: string): string[] {
  return db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.projectId, projectId))
    .all()
    .map((r) => r.id);
}

export function mcpServersOfProject(
  projectId: string,
): { id: string; name: string; allAgents: boolean }[] {
  return db
    .select()
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.projectId, projectId))
    .all()
    .map((r) => ({ id: r.id, name: r.name, allAgents: r.allAgents }));
}

export function getEnvironment(
  environmentId: string,
): typeof schema.environments.$inferSelect | undefined {
  return db
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, environmentId))
    .get();
}

export function getProject(projectId: string): typeof schema.projects.$inferSelect | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
}
