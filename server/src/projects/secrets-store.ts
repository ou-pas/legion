// Queries for `secrets.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type SecretRow = typeof schema.secrets.$inferSelect;

export function secretRowsByName(projectId: string, name: string): SecretRow[] {
  return db
    .select()
    .from(schema.secrets)
    .where(and(eq(schema.secrets.projectId, projectId), eq(schema.secrets.name, name)))
    .all();
}

export function secretRowById(id: string): SecretRow | undefined {
  return db.select().from(schema.secrets).where(eq(schema.secrets.id, id)).get();
}

/** Deletes the given rows then inserts the new one in the same transaction: a failure between the two
 *  would erase the key without replacing it. */
export function replaceSecret(
  previousIds: readonly string[],
  row: {
    id: string;
    projectId: string;
    name: string;
    label: string | null;
    ciphertext: string;
    /** v74: NULL for a secret set by hand, which Legion cannot renew. */
    refreshCiphertext: string | null;
    /** v74: clear JSON, or NULL. Never a secret. */
    metadata: string | null;
    createdAt: Date;
  },
): void {
  db.transaction((tx) => {
    for (const id of previousIds) tx.delete(schema.secrets).where(eq(schema.secrets.id, id)).run();
    tx.insert(schema.secrets).values(row).run();
  });
}

export function updateSecretLabel(id: string, label: string | null): void {
  db.update(schema.secrets).set({ label }).where(eq(schema.secrets.id, id)).run();
}

export function deleteSecretRow(id: string): void {
  db.delete(schema.secrets).where(eq(schema.secrets.id, id)).run();
}
