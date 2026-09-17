// Query for the turn relaunch; the rules live in `turn-relaunch.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SessionRow = typeof schema.sessions.$inferSelect;

export function sessionRow(sessionId: string): SessionRow | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
}
