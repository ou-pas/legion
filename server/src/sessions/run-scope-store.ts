// Queries for the current run; the rules live in `run-scope.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

/** A status event, reduced to what the rule reads. */
export interface StatusEvent {
  at: Date;
  payload: string;
}

/** In database order. */
export function statusEventsOf(sessionId: string): StatusEvent[] {
  return db
    .select({ at: schema.sessionEvents.createdAt, payload: schema.sessionEvents.payload })
    .from(schema.sessionEvents)
    .where(
      and(eq(schema.sessionEvents.sessionId, sessionId), eq(schema.sessionEvents.type, "status")),
    )
    .all();
}
