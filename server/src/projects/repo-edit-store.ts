// Queries for `repo-edit.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type RepoRow = typeof schema.repos.$inferSelect;
type AgentRow = typeof schema.agents.$inferSelect;

export function projectExists(projectId: string): boolean {
  return (
    db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get() !== undefined
  );
}

export function repoRowsOfProject(projectId: string): RepoRow[] {
  return db.select().from(schema.repos).where(eq(schema.repos.projectId, projectId)).all();
}

export function repoRowById(id: string): RepoRow | undefined {
  return db.select().from(schema.repos).where(eq(schema.repos.id, id)).get();
}

export function insertRepoRow(row: typeof schema.repos.$inferInsert): void {
  db.insert(schema.repos).values(row).run();
}

export function updateRepoRow(id: string, patch: Partial<typeof schema.repos.$inferInsert>): void {
  db.update(schema.repos).set(patch).where(eq(schema.repos.id, id)).run();
}

export function deleteRepoRow(id: string): void {
  db.delete(schema.repos).where(eq(schema.repos.id, id)).run();
}

export function agentRowsOfProject(projectId: string): AgentRow[] {
  return db.select().from(schema.agents).where(eq(schema.agents.projectId, projectId)).all();
}

export function updateAgentRepoNames(agentId: string, repoNames: string): void {
  db.update(schema.agents).set({ repoNames }).where(eq(schema.agents.id, agentId)).run();
}

/** Removing a repository may touch N agents: a transaction, even though better-sqlite3 is
 *  synchronous, so an exception midway does not leave half the grants cleaned. */
export function withTransaction<T>(fn: () => T): T {
  return db.transaction(fn);
}
