// Reads behind `inbox-question.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type InboxRow = typeof schema.inboxMessages.$inferSelect;

export function inboxRowById(id: string): InboxRow | undefined {
  return db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, id)).get();
}

export function taskById(id: string) {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
}

export function agentById(id: string) {
  return db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
}
