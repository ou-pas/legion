// Database read for `role-edit.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export function getAgent(agentId: string): typeof schema.agents.$inferSelect | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}
