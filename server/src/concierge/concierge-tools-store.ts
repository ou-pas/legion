// Reads behind the concierge tools; decisions live in `concierge-tools.ts`.
//
// `concierge-context-store.ts` sweeps the control plane into a summary that fits a prompt. These
// queries go down to one named object, for what the summary does not carry: "why is this task
// failing?" (08/09) failed because the trace saying why was in no context. Two files because one
// is bounded by the prompt, the other by what a tool asks for.
import { and, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

export type TaskRow = typeof schema.tasks.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;
export type SessionEventRow = typeof schema.sessionEvents.$inferSelect;

/** A task and its project name, joined: no tool answer cites a task without saying where it is
 *  from. */
export interface TaskWithProject {
  task: TaskRow;
  projectName: string;
}

export function taskWithProject(taskId: string): TaskWithProject | null {
  const row = db
    .select({ task: schema.tasks, projectName: schema.projects.name })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(eq(schema.tasks.id, taskId))
    .get();
  return row ?? null;
}

/** A task's sessions, newest first, with the agent name joined. */
export function sessionsOfTask(taskId: string): { session: SessionRow; agentName: string }[] {
  return db
    .select({ session: schema.sessions, agentName: schema.agents.name })
    .from(schema.sessions)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.sessions.agentId))
    .where(eq(schema.sessions.taskId, taskId))
    .orderBy(desc(schema.sessions.startedAt))
    .all();
}

/** The trace of several sessions, newest first, so the cap cuts the oldest lines.
 *
 *  Empty `types` means all. Filtering happens in SQL: a chatty session has thousands of rows of
 *  several kilobytes each, and loading them to keep twenty is what context discipline forbids. */
export function eventsOfSessions(
  sessionIds: string[],
  types: string[],
  limit: number,
): SessionEventRow[] {
  if (sessionIds.length === 0) return [];
  const scope = inArray(schema.sessionEvents.sessionId, sessionIds);
  const where = types.length > 0 ? and(scope, inArray(schema.sessionEvents.type, types)) : scope;
  return db
    .select()
    .from(schema.sessionEvents)
    .where(where)
    .orderBy(desc(schema.sessionEvents.id))
    .limit(limit)
    .all();
}

export interface TaskSearch {
  text: string | null;
  status: string | null;
  projectId: string | null;
  limit: number;
}

/** Task search. `text` matches the name and the brief: asking the caller which one it means would
 *  make it guess what it is looking for. */
export function searchTasks(opts: TaskSearch): TaskWithProject[] {
  const clauses: SQL[] = [];
  if (opts.text !== null) {
    const needle = `%${opts.text}%`;
    const match = or(like(schema.tasks.name, needle), like(schema.tasks.description, needle));
    if (match) clauses.push(match);
  }
  if (opts.status !== null) clauses.push(eq(schema.tasks.status, opts.status as TaskRow["status"]));
  if (opts.projectId !== null) clauses.push(eq(schema.tasks.projectId, opts.projectId));

  const where = clauses.length > 0 ? and(...clauses) : undefined;
  return db
    .select({ task: schema.tasks, projectName: schema.projects.name })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(where)
    .orderBy(desc(schema.tasks.updatedAt))
    .limit(opts.limit)
    .all();
}
