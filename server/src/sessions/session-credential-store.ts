// Query for the account memory; the rules live in `session-credential.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

/** Records on the session the credential THIS run uses. `null` = fallback, see the caller. */
export function rememberSessionCredential(sessionId: string, credentialId: string | null): void {
  db.update(schema.sessions).set({ credentialId }).where(eq(schema.sessions.id, sessionId)).run();
}
