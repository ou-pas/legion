// Query for the guard; the rules live in `session-guard.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

/** `null` if unknown. Reread RIGHT BEFORE the write by the caller: that is the guard's point, see
 *  `session-guard.ts`. */
export function sessionStatus(sessionId: string): string | null {
  return (
    db
      .select({ status: schema.sessions.status })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get()?.status ?? null
  );
}
