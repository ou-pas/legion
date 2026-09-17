// Queries for the repository grant; the rules live in `repo-grant.ts`.
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type AgentRow = typeof schema.agents.$inferSelect;
export type RepoRow = typeof schema.repos.$inferSelect;

/** Sorting by name is the caller's rule. */
export function reposOfProject(projectId: string): RepoRow[] {
  return db.select().from(schema.repos).where(eq(schema.repos.projectId, projectId)).all();
}

export function agentRow(agentId: string): AgentRow | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}

export function writeAgentRepoNames(agentId: string, repoNames: readonly string[]): void {
  db.update(schema.agents)
    .set({ repoNames: JSON.stringify(repoNames) })
    .where(eq(schema.agents.id, agentId))
    .run();
}
