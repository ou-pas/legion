// Queries for `auth.ts`, which decrypts and decides the fallback.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SecretRow = typeof schema.secrets.$inferSelect;

export function credentialSecretRows(projectId: string, names: readonly string[]): SecretRow[] {
  return db
    .select()
    .from(schema.secrets)
    .where(and(eq(schema.secrets.projectId, projectId), inArray(schema.secrets.name, names)))
    .all();
}
