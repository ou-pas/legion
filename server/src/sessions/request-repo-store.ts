// Queries for the repository request; the rules live in `request-repo.ts`.
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { INBOX_STATUS } from "../inbox/inbox-enums.js";

export type SessionRow = typeof schema.sessions.$inferSelect;
export type TaskRow = typeof schema.tasks.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;

export function sessionRow(sessionId: string): SessionRow | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
}

export function taskRow(taskId: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

export function agentRow(agentId: string): AgentRow | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}

/** In database order: sorting is the caller's rule, since it composes a message a model reads. */
export function repoNamesOfProject(projectId: string): string[] {
  return db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.projectId, projectId))
    .all()
    .map((r) => r.name);
}

export function openGrantRequestOf(sessionId: string) {
  return db
    .select()
    .from(schema.inboxMessages)
    .where(
      and(
        eq(schema.inboxMessages.sessionId, sessionId),
        eq(schema.inboxMessages.status, INBOX_STATUS.open),
        isNotNull(schema.inboxMessages.grantRepoName),
      ),
    )
    .get();
}
