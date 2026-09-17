// Integration queries; decisions live in the neighbouring files. One store for the domain:
// `forge-access.ts`, `inbound-webhooks.ts` and `linear.ts` ask the same two questions (which
// repositories of this project, and which secret unlocks them).
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type RepoRow = typeof schema.repos.$inferSelect;

export function repoRowsOf(projectId: string): RepoRow[] {
  return db.select().from(schema.repos).where(eq(schema.repos.projectId, projectId)).all();
}

/** A project's repositories whose name is in the list. An empty list returns an empty list without
 *  querying: the caller's rule, not an `IN ()`. */
export function repoRowsNamed(projectId: string, names: readonly string[]): RepoRow[] {
  if (names.length === 0) return [];
  return db
    .select()
    .from(schema.repos)
    .where(and(eq(schema.repos.projectId, projectId), inArray(schema.repos.name, [...names])))
    .all();
}

export function repoRow(repoId: string): RepoRow | undefined {
  return db.select().from(schema.repos).where(eq(schema.repos.id, repoId)).get();
}

/** A project's secret, still encrypted. Which secret name unlocks which forge is `credentialFor`'s
 *  rule. */
export function secretCiphertextOf(projectId: string, secretName: string): string | null {
  const row = db
    .select()
    .from(schema.secrets)
    .where(and(eq(schema.secrets.projectId, projectId), eq(schema.secrets.name, secretName)))
    .get();
  return row ? row.ciphertext : null;
}

/** Records on the repository the webhook the forge just accepted. */
export function setRepoWebhook(repoId: string, webhookId: string, webhookUrl: string): void {
  db.update(schema.repos).set({ webhookId, webhookUrl }).where(eq(schema.repos.id, repoId)).run();
}
