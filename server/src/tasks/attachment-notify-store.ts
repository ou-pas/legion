// The status of the session to notify, re-read at notice time rather than at drop time (see
// `attachment-notify.ts`).
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export function sessionStatusOf(sessionId: string): string | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()?.status;
}
