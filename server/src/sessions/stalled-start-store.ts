// Queries for the stalled start; the rules live in `stalled-start.ts`.
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SessionRow = typeof schema.sessions.$inferSelect;

/** Picking the stalled ones is the caller's rule (`stalledStarts`). */
export function startingSessions(): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(inArray(schema.sessions.status, ["starting"]))
    .all();
}

/** `null` if the row is gone. */
export function taskNameOf(taskId: string): string | null {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()?.name ?? null;
}
