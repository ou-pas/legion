// Database access for `mcp-edit.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type McpServerRow = typeof schema.mcpServers.$inferSelect;

export function mcpServersOf(projectId: string | undefined): McpServerRow[] {
  return projectId
    ? db.select().from(schema.mcpServers).where(eq(schema.mcpServers.projectId, projectId)).all()
    : db.select().from(schema.mcpServers).all();
}

export function getMcpServer(id: string): McpServerRow | undefined {
  return db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).get();
}

export function insertMcpServer(row: McpServerRow): void {
  db.insert(schema.mcpServers).values(row).run();
}

export function setMcpServerAllAgentsField(id: string, allAgents: boolean): void {
  db.update(schema.mcpServers).set({ allAgents }).where(eq(schema.mcpServers.id, id)).run();
}

export function deleteMcpServerRow(id: string): void {
  db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id)).run();
}
