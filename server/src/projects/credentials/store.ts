// Queries for a project's Claude credentials. Decryption, validation and rank computation live in
// `index.ts`.
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";

export type CredentialRow = typeof schema.credentials.$inferSelect;

export function credentialRowsOf(projectId: string): CredentialRow[] {
  return db
    .select()
    .from(schema.credentials)
    .where(eq(schema.credentials.projectId, projectId))
    .orderBy(asc(schema.credentials.rank))
    .all();
}

export function credentialRowById(id: string): CredentialRow | undefined {
  return db.select().from(schema.credentials).where(eq(schema.credentials.id, id)).get();
}

export function projectRowExists(projectId: string): boolean {
  return (
    db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get() !== undefined
  );
}

export function insertCredentialRow(row: {
  id: string;
  projectId: string;
  name: string;
  rank: number;
  ciphertext: string;
  label: string | null;
  createdAt: Date;
}): void {
  db.insert(schema.credentials).values(row).run();
}

export function updateCredentialExhaustion(
  credentialId: string,
  window: string,
  until: Date,
): void {
  db.update(schema.credentials)
    .set({ exhaustedUntil: until, exhaustedWindow: window })
    .where(eq(schema.credentials.id, credentialId))
    .run();
}

export function updateCredentialLabel(id: string, label: string | null): void {
  db.update(schema.credentials).set({ label }).where(eq(schema.credentials.id, id)).run();
}

export function deleteCredentialRow(id: string): void {
  db.delete(schema.credentials).where(eq(schema.credentials.id, id)).run();
}

/** Writes ranks 1..n in the given order. The detour through negatives is needed: the unique index
 *  (project, rank) is checked on each UPDATE, so writing new ranks directly would collide. */
export function reorderCredentialRows(projectId: string, orderedIds: readonly string[]): void {
  db.transaction((tx) => {
    tx.update(schema.credentials)
      .set({ rank: sql`-${schema.credentials.rank}` })
      .where(and(eq(schema.credentials.projectId, projectId), sql`${schema.credentials.rank} > 0`))
      .run();
    orderedIds.forEach((cid, i) => {
      tx.update(schema.credentials)
        .set({ rank: i + 1 })
        .where(eq(schema.credentials.id, cid))
        .run();
    });
  });
}
