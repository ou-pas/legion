// Database access for `promote.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

type AgentTemplateRow = typeof schema.agentTemplates.$inferSelect;
type AgentTemplateValues = Omit<AgentTemplateRow, "id" | "createdAt">;

export function getAgent(agentId: string): typeof schema.agents.$inferSelect | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}

export function allAgentTemplates(): AgentTemplateRow[] {
  return db.select().from(schema.agentTemplates).all();
}

export function updateAgentTemplate(id: string, values: AgentTemplateValues): void {
  db.update(schema.agentTemplates).set(values).where(eq(schema.agentTemplates.id, id)).run();
}

export function insertAgentTemplate(row: AgentTemplateRow): void {
  db.insert(schema.agentTemplates).values(row).run();
}
