// Reads for the situation report; what gets shown is chosen in `concierge-context.ts`.
// The concierge spans every project, like `GET /api/tasks`, so these queries have no filter.
import { desc, gte } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type ProjectRow = typeof schema.projects.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;
export type TaskRow = typeof schema.tasks.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;

export function allProjects(): ProjectRow[] {
  return db.select().from(schema.projects).all();
}

export function allAgents(): AgentRow[] {
  return db.select().from(schema.agents).all();
}

export function allTasks(): TaskRow[] {
  return db.select().from(schema.tasks).all();
}

/** Sessions started since `cutoff`, newest first. One query serves both the cost and the displayed
 *  list, so the two cannot disagree on what "recent" means. */
export function sessionsStartedSince(cutoff: Date): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(gte(schema.sessions.startedAt, cutoff))
    .orderBy(desc(schema.sessions.startedAt))
    .all();
}
