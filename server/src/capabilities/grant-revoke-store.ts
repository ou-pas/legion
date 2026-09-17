// Database access for `grant-revoke.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type AgentRow = typeof schema.agents.$inferSelect;

export function ruleProjectId(id: string): string | null {
  return db.select().from(schema.rules).where(eq(schema.rules.id, id)).get()?.projectId ?? null;
}

export function mcpServerProjectId(id: string): string | null {
  return (
    db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).get()?.projectId ?? null
  );
}

export function agentsOfProject(projectId: string): AgentRow[] {
  return db.select().from(schema.agents).where(eq(schema.agents.projectId, projectId)).all();
}

export function allAgents(): AgentRow[] {
  return db.select().from(schema.agents).all();
}

export function updateAgentFields(agentId: string, fields: Partial<AgentRow>): void {
  db.update(schema.agents).set(fields).where(eq(schema.agents.id, agentId)).run();
}

/** The sweep removes a grant from N agents in one transaction (see `grant-revoke.ts`). */
export function withTransaction<T>(fn: () => T): T {
  return db.transaction(fn);
}
