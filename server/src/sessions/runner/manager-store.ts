// Queries for the `manager` family; nothing decides here.
//
// One store for the seven modules that make up a session launch (`manager.ts`, `chosen-runner.ts`,
// `spec.ts`, `brief.ts`, `lifecycle.ts`, `queue.ts`, `recovery.ts`), deliberately: they ask the
// database the SAME questions (task, agent, project, runner, session). A store per module would
// have made six copies of `taskRow`, diverging at the first added filter.
//
// `isDemoProject` is re-exported from here for the same reason: this is the family's only point
// touching `shared/db.js`.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, isDemoProject, schema } from "../../shared/db.js";
import { SESSION_STATUS } from "../session-terminal.js";
import { TASK_STATUS } from "../../tasks/lifecycle.js";

export { isDemoProject };

export type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

export type TaskRow = Row<typeof schema.tasks>;
export type AgentRow = Row<typeof schema.agents>;
export type ProjectRow = Row<typeof schema.projects>;
export type RunnerRow = Row<typeof schema.runners>;
export type SessionRow = Row<typeof schema.sessions>;

export function taskRow(taskId: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

export function agentRow(agentId: string): AgentRow | undefined {
  return db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
}

export function projectRow(projectId: string): ProjectRow | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
}

export function runnerRow(runnerId: string): RunnerRow | undefined {
  return db.select().from(schema.runners).where(eq(schema.runners.id, runnerId)).get();
}

export function sessionRow(sessionId: string): SessionRow | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
}

/** `null` if the session is unknown. */
export function sessionStatusOf(sessionId: string): string | null {
  return (
    db
      .select({ s: schema.sessions.status })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .get()?.s ?? null
  );
}

/** The whole registry, enabled or not: a choice pointing at a disabled machine must read
 *  "disabled", not "no longer exists". */
export function allRunnerRows(): RunnerRow[] {
  return db.select().from(schema.runners).all();
}

/** Which statuses count as occupying is the caller's rule. */
export function sessionCountByRunnerInStatus(
  statuses: readonly SessionRow["status"][],
): Map<string, number> {
  return new Map(
    db
      .select({ runnerId: schema.sessions.runnerId, n: sql<number>`count(*)` })
      .from(schema.sessions)
      .where(inArray(schema.sessions.status, [...statuses]))
      .groupBy(schema.sessions.runnerId)
      .all()
      .map((a) => [a.runnerId, a.n]),
  );
}

export function sessionsInStatus(statuses: readonly SessionRow["status"][]): SessionRow[] {
  return db
    .select()
    .from(schema.sessions)
    .where(inArray(schema.sessions.status, [...statuses]))
    .all();
}

export function lastResultEvent(sessionId: string): { payload: string } | undefined {
  return db
    .select({ payload: schema.sessionEvents.payload })
    .from(schema.sessionEvents)
    .where(
      and(eq(schema.sessionEvents.sessionId, sessionId), eq(schema.sessionEvents.type, "result")),
    )
    .orderBy(desc(schema.sessionEvents.id))
    .limit(1)
    .get();
}

/** In insertion order. Trimming is the caller's rule (`diagnoseFailure` keeps only the tail). */
export function sessionEventsOf(sessionId: string): { type: string; payload: string }[] {
  return db
    .select({ type: schema.sessionEvents.type, payload: schema.sessionEvents.payload })
    .from(schema.sessionEvents)
    .where(eq(schema.sessionEvents.sessionId, sessionId))
    .all();
}

export function markSessionRunning(sessionId: string, runtimeHandle: string): void {
  db.update(schema.sessions)
    .set({ status: SESSION_STATUS.running, runtimeHandle })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

/** Sorting and exclusions are the caller's rule. */
export function todoTasks(): TaskRow[] {
  return db.select().from(schema.tasks).where(eq(schema.tasks.status, TASK_STATUS.todo)).all();
}

/** `null` if the agent has none (or does not exist). */
export function runnerPreferenceOf(agentId: string): string | null {
  return agentRow(agentId)?.runnerPreference ?? null;
}

/** Which statuses count as active is the caller's rule. */
export function activeSessionOfTask(
  taskId: string,
  statuses: readonly SessionRow["status"][],
): SessionRow | undefined {
  return db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.taskId, taskId), inArray(schema.sessions.status, [...statuses])))
    .get();
}

export function setTaskQueued(taskId: string, queued: boolean, updatedAt?: Date): void {
  db.update(schema.tasks)
    .set(updatedAt ? { queued, updatedAt } : { queued })
    .where(eq(schema.tasks.id, taskId))
    .run();
}

/** `undefined` if the agent has none or it disappeared. */
export function environmentRow(environmentId: string): Row<typeof schema.environments> | undefined {
  return db
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, environmentId))
    .get();
}

/** Filtering by granted name is the caller's rule. */
export function reposOfProject(projectId: string): Row<typeof schema.repos>[] {
  return db.select().from(schema.repos).where(eq(schema.repos.projectId, projectId)).all();
}

export function secretNamesOfProject(projectId: string): string[] {
  return db
    .select({ name: schema.secrets.name })
    .from(schema.secrets)
    .where(eq(schema.secrets.projectId, projectId))
    .all()
    .map((s) => s.name);
}

/** Encrypted, as stored. */
export function secretsNamed(
  projectId: string,
  names: readonly string[],
): { name: string; ciphertext: string }[] {
  if (names.length === 0) return [];
  return db
    .select({ name: schema.secrets.name, ciphertext: schema.secrets.ciphertext })
    .from(schema.secrets)
    .where(and(eq(schema.secrets.projectId, projectId), inArray(schema.secrets.name, [...names])))
    .all();
}

/** The slot reservation. See `runTask`'s invariant: it precedes the first `await`. */
export function insertSession(values: {
  id: string;
  taskId: string;
  agentId: string;
  runnerId: string;
  model: string;
  status: SessionRow["status"];
  callbackToken: string;
  mock: boolean;
  startedAt: Date;
}): void {
  db.insert(schema.sessions).values(values).run();
}

export function markSessionResuming(sessionId: string, resumeCount: number): void {
  db.update(schema.sessions)
    .set({ status: SESSION_STATUS.starting, resumeCount })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}
