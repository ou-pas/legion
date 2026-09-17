// Queries for the session end; the rules live in `session-terminal.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

type SessionStatusColumn = (typeof schema.sessions.$inferSelect)["status"];

/** The reason is PERSISTED (v22), not only published: the event serves the live subscriber, the
 *  column serves whoever arrives later, without replaying the trace. */
export function writeSessionEnd(
  sessionId: string,
  status: SessionStatusColumn,
  endedAt: Date,
  endReason: string,
): void {
  db.update(schema.sessions)
    .set({ status, endedAt, endReason })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}
