// Queries for cascading deletes. Footprint and the live-session guard are in `purge.ts`; the
// foreign-key delete order is here.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import type { SessionStatus } from "../sessions/session-terminal.js";

export type ProjectRow = typeof schema.projects.$inferSelect;
export type AgentRow = typeof schema.agents.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;
export type TaskRow = typeof schema.tasks.$inferSelect;

export function projectRowById(id: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

export function taskRowById(id: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
}

export function agentRowById(id: string): AgentRow | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
}

export function taskIdsOfProject(projectId: string): string[] {
  return db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId))
    .all()
    .map((t) => t.id);
}

export function sessionIdsOfTasks(taskIds: readonly string[]): string[] {
  if (taskIds.length === 0) return [];
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(inArray(schema.sessions.taskId, [...taskIds]))
    .all()
    .map((s) => s.id);
}

export function sessionIdsOfTask(taskId: string): string[] {
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .all()
    .map((s) => s.id);
}

export function goalIdsOfProject(projectId: string): string[] {
  return db
    .select({ id: schema.goals.id })
    .from(schema.goals)
    .where(eq(schema.goals.projectId, projectId))
    .all()
    .map((g) => g.id);
}

export function countInboxOfTasks(taskIds: readonly string[]): number {
  if (taskIds.length === 0) return 0;
  return db
    .select({ id: schema.inboxMessages.id })
    .from(schema.inboxMessages)
    .where(inArray(schema.inboxMessages.taskId, [...taskIds]))
    .all().length;
}

export function countAgentsOfProject(projectId: string): number {
  return db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.projectId, projectId))
    .all().length;
}

export function countGoalsOfProject(projectId: string): number {
  return db
    .select({ id: schema.goals.id })
    .from(schema.goals)
    .where(eq(schema.goals.projectId, projectId))
    .all().length;
}

export function countReposOfProject(projectId: string): number {
  return db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(eq(schema.repos.projectId, projectId))
    .all().length;
}

export function countRulesOfProject(projectId: string): number {
  return db
    .select({ id: schema.rules.id })
    .from(schema.rules)
    .where(eq(schema.rules.projectId, projectId))
    .all().length;
}

export function countMcpServersOfProject(projectId: string): number {
  return db
    .select({ id: schema.mcpServers.id })
    .from(schema.mcpServers)
    .where(eq(schema.mcpServers.projectId, projectId))
    .all().length;
}

export function countSecretsOfProject(projectId: string): number {
  return db
    .select({ id: schema.secrets.id })
    .from(schema.secrets)
    .where(eq(schema.secrets.projectId, projectId))
    .all().length;
}

export function countEnvironmentsOfProject(projectId: string): number {
  return db
    .select({ id: schema.environments.id })
    .from(schema.environments)
    .where(eq(schema.environments.projectId, projectId))
    .all().length;
}

export function countTemplatesOfProject(projectId: string): number {
  return db
    .select({ id: schema.taskTemplates.id })
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.projectId, projectId))
    .all().length;
}

export function countSessionEventsOfSessions(sessionIds: readonly string[]): number {
  if (sessionIds.length === 0) return 0;
  return db
    .select({ id: schema.sessionEvents.id })
    .from(schema.sessionEvents)
    .where(inArray(schema.sessionEvents.sessionId, [...sessionIds]))
    .all().length;
}

export function countInboxOfTask(taskId: string): number {
  return db
    .select({ id: schema.inboxMessages.id })
    .from(schema.inboxMessages)
    .where(eq(schema.inboxMessages.taskId, taskId))
    .all().length;
}

export function countActivityOfTask(taskId: string): number {
  return db
    .select({ id: schema.taskActivity.id })
    .from(schema.taskActivity)
    .where(eq(schema.taskActivity.taskId, taskId))
    .all().length;
}

export function sessionRowsForTasksInStatuses(
  taskIds: readonly string[],
  statuses: readonly SessionStatus[],
): SessionRow[] {
  if (taskIds.length === 0) return [];
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(
        inArray(schema.sessions.taskId, [...taskIds]),
        inArray(schema.sessions.status, [...statuses]),
      ),
    )
    .all();
}

export function sessionRowsForTaskInStatuses(
  taskId: string,
  statuses: readonly SessionStatus[],
): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.taskId, taskId), inArray(schema.sessions.status, [...statuses])))
    .all();
}

export function sessionRowsForAgentInStatuses(
  agentId: string,
  statuses: readonly SessionStatus[],
): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(
      and(eq(schema.sessions.agentId, agentId), inArray(schema.sessions.status, [...statuses])),
    )
    .all();
}

export function taskNamesByIds(taskIds: readonly string[]): Map<string, string> {
  if (taskIds.length === 0) return new Map();
  return new Map(
    db
      .select({ id: schema.tasks.id, name: schema.tasks.name })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, [...taskIds]))
      .all()
      .map((t) => [t.id, t.name]),
  );
}

/** Deletes the project and its descendants in the order foreign keys impose (graph in the header of
 *  `purge.ts`), in one transaction. */
export function deleteProjectCascade(input: {
  projectId: string;
  taskIds: readonly string[];
  sessionIds: readonly string[];
  goalIds: readonly string[];
}): void {
  const { projectId, taskIds, sessionIds, goalIds } = input;
  db.transaction(() => {
    if (goalIds.length)
      db.delete(schema.goalEvents)
        .where(inArray(schema.goalEvents.goalId, [...goalIds]))
        .run();
    db.delete(schema.goals).where(eq(schema.goals.projectId, projectId)).run();
    if (sessionIds.length)
      db.delete(schema.sessionEvents)
        .where(inArray(schema.sessionEvents.sessionId, [...sessionIds]))
        .run();
    // Steering messages (v23) reference the session: without this, `foreign_keys = ON` fails the
    // project delete as soon as anyone has talked to an agent once.
    if (sessionIds.length)
      db.delete(schema.sessionSteers)
        .where(inArray(schema.sessionSteers.sessionId, [...sessionIds]))
        .run();
    if (taskIds.length) {
      db.delete(schema.inboxMessages)
        .where(inArray(schema.inboxMessages.taskId, [...taskIds]))
        .run();
      db.delete(schema.taskActivity)
        .where(inArray(schema.taskActivity.taskId, [...taskIds]))
        .run();
      // v32: pre-review comments follow their task (no FK, on purpose: this is where "a deleted
      // task takes its noise with it" holds).
      db.delete(schema.reviewComments)
        .where(inArray(schema.reviewComments.taskId, [...taskIds]))
        .run();
      db.delete(schema.sessions)
        .where(inArray(schema.sessions.taskId, [...taskIds]))
        .run();
    }
    // Tasks before agents (tasks.assignee_agent_id → agents.id).
    db.delete(schema.tasks).where(eq(schema.tasks.projectId, projectId)).run();
    db.delete(schema.taskTemplates).where(eq(schema.taskTemplates.projectId, projectId)).run();
    db.delete(schema.secrets).where(eq(schema.secrets.projectId, projectId)).run();
    db.delete(schema.rules).where(eq(schema.rules.projectId, projectId)).run();
    db.delete(schema.mcpServers).where(eq(schema.mcpServers.projectId, projectId)).run();
    db.delete(schema.repos).where(eq(schema.repos.projectId, projectId)).run();
    // Agents before environments (agents.environment_id → environments.id).
    db.delete(schema.agents).where(eq(schema.agents.projectId, projectId)).run();
    db.delete(schema.environments).where(eq(schema.environments.projectId, projectId)).run();
    db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
  });
}

/** Deletes a task and its descendants in a transaction. `onBeforeDelete` releases blocking links
 *  (`tasks/blockers.js`) and must run inside the same transaction, before the row disappears. */
export function deleteTaskCascade(
  taskId: string,
  sessionIds: readonly string[],
  onBeforeDelete: () => void,
): void {
  db.transaction(() => {
    if (sessionIds.length)
      db.delete(schema.sessionEvents)
        .where(inArray(schema.sessionEvents.sessionId, [...sessionIds]))
        .run();
    // Same on the task side (v23): the steering queue goes before the sessions it cites.
    if (sessionIds.length)
      db.delete(schema.sessionSteers)
        .where(inArray(schema.sessionSteers.sessionId, [...sessionIds]))
        .run();
    db.delete(schema.inboxMessages).where(eq(schema.inboxMessages.taskId, taskId)).run();
    db.delete(schema.reviewComments).where(eq(schema.reviewComments.taskId, taskId)).run(); // v32
    db.delete(schema.taskActivity).where(eq(schema.taskActivity.taskId, taskId)).run();
    db.delete(schema.sessions).where(eq(schema.sessions.taskId, taskId)).run();
    onBeforeDelete();
    db.delete(schema.tasks).where(eq(schema.tasks.id, taskId)).run();
  });
}
