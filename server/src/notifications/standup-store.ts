// Database access for `standup.ts`. Status splits, PR extraction
// and the 24 h window are decided in `standup.ts`.
import { eq, gte } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export function allGoals(): (typeof schema.goals.$inferSelect)[] {
  return db.select().from(schema.goals).all();
}

export function allTasks(): (typeof schema.tasks.$inferSelect)[] {
  return db.select().from(schema.tasks).all();
}

export function openInboxMessages(): (typeof schema.inboxMessages.$inferSelect)[] {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(eq(schema.inboxMessages.status, "open"))
    .all();
}

export function sessionsSince(since: Date): (typeof schema.sessions.$inferSelect)[] {
  return db.select().from(schema.sessions).where(gte(schema.sessions.startedAt, since)).all();
}
