// Queries of the operator domain: the instance token hash and the sessions table. The rules
// (comparison, generation, authorisation) live in `operator.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { getSetting, setSetting } from "../shared/settings.js";

/** A hash, never the clear token: a leaked database must give a way to verify, not to get in. */
export const TOKEN_HASH_KEY = "operator.token_hash";

export function operatorTokenHash(): string | null {
  return getSetting(TOKEN_HASH_KEY);
}

export function saveOperatorTokenHash(hash: string): void {
  setSetting(TOKEN_HASH_KEY, hash);
}

export type OperatorSessionRow = typeof schema.operatorSessions.$inferSelect;

export function operatorSessionRow(id: string): OperatorSessionRow | undefined {
  return db.select().from(schema.operatorSessions).where(eq(schema.operatorSessions.id, id)).get();
}

export function insertOperatorSession(values: typeof schema.operatorSessions.$inferInsert): void {
  db.insert(schema.operatorSessions).values(values).run();
}

export function touchOperatorSession(id: string, at: Date): void {
  db.update(schema.operatorSessions)
    .set({ lastSeenAt: at })
    .where(eq(schema.operatorSessions.id, id))
    .run();
}

export function deleteOperatorSession(id: string): void {
  db.delete(schema.operatorSessions).where(eq(schema.operatorSessions.id, id)).run();
}

export function allOperatorSessions(): OperatorSessionRow[] {
  return db.select().from(schema.operatorSessions).all();
}
