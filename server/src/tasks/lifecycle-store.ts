// The only writer of a task's status, the session lookups automatic settlement needs, and its
// control-plane trace. No rule here: `lifecycle.ts` decides what to write and why.
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db, logControlEvent, schema } from "../shared/db.js";
import { FS_OP_EVENT, REPO_CHECKPOINT_EVENT, REPO_PUSH_EVENT } from "../shared/events.js";
import { ACTIVE_STATUSES } from "../sessions/session-terminal.js";

type TaskStatus = (typeof schema.tasks.$inferSelect)["status"];
type TaskStatusWrite = Partial<
  Pick<
    typeof schema.tasks.$inferInsert,
    "archived" | "boardOrder" | "description" | "queued" | "settledOutcome"
  >
>;

/** The only `UPDATE` of a task's status. The rule (which transition writes what, from which
 *  statuses) lives in `applyTaskTransition` (`lifecycle.ts`); here, only the write. Returns `true`
 *  if a row moved. */
export function writeTaskStatus(
  taskId: string,
  fields: TaskStatusWrite & { status: TaskStatus; updatedAt: Date },
  requireStatusIn: readonly TaskStatus[] | null,
): boolean {
  const r = db
    .update(schema.tasks)
    .set(fields)
    .where(
      requireStatusIn
        ? and(eq(schema.tasks.id, taskId), inArray(schema.tasks.status, [...requireStatusIn]))
        : eq(schema.tasks.id, taskId),
    )
    .run();
  return r.changes > 0;
}

/** The branch already set by a sibling of the same run (chain or goal), if any (see `taskBranch`,
 *  `lifecycle.ts`). */
export function siblingBranchOf(scope: string): string | null {
  const row = db
    .select({ branch: schema.tasks.branch })
    .from(schema.tasks)
    .where(
      and(
        or(eq(schema.tasks.templateRunId, scope), eq(schema.tasks.goalId, scope)),
        isNotNull(schema.tasks.branch),
      ),
    )
    .get();
  return row?.branch ?? null;
}

/** Sets the branch only if unset: `WHERE branch IS NULL` closes the race between two simultaneous
 *  derivations, the first wins. */
export function persistBranchIfUnset(taskId: string, branch: string): void {
  db.update(schema.tasks)
    .set({ branch })
    .where(and(eq(schema.tasks.id, taskId), isNull(schema.tasks.branch)))
    .run();
}

export function hasActiveSession(taskId: string): boolean {
  return (
    db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.taskId, taskId),
          inArray(schema.sessions.status, [...ACTIVE_STATUSES]),
        ),
      )
      .all().length > 0
  );
}

/** The task's latest session. */
export function lastSessionOf(taskId: string): typeof schema.sessions.$inferSelect | undefined {
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .orderBy(desc(schema.sessions.startedAt))
    .get();
}

export function sessionIdsOf(taskId: string): string[] {
  return db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.taskId, taskId))
    .all()
    .map((s) => s.id);
}

/** `repo_push`/`repo_checkpoint`/`fs_op` events of the given sessions: the signal that a task
 *  produced something (see `taskProducedSomething`, `lifecycle.ts`). */
export function pushOrFsOpEvents(sessionIds: string[]): { type: string; payload: string }[] {
  if (sessionIds.length === 0) return [];
  return db
    .select({ type: schema.sessionEvents.type, payload: schema.sessionEvents.payload })
    .from(schema.sessionEvents)
    .where(
      and(
        inArray(schema.sessionEvents.sessionId, sessionIds),
        inArray(schema.sessionEvents.type, [REPO_PUSH_EVENT, REPO_CHECKPOINT_EVENT, FS_OP_EVENT]),
      ),
    )
    .all();
}

/** The control-plane trace of an automatic settlement (see `logAutomaticSettlement`, `lifecycle.ts`). */
export function logAutomaticSettlementEvent(
  taskId: string,
  message: string,
  details: { outcome: string; sessionId: string | null; endReason: string | null },
): void {
  logControlEvent("warn", "task-settle", message, { taskId, ...details });
}

/** Bulk archive: see `archiveDoneTasks` (`lifecycle.ts`). Returns the number of rows touched, zero
 *  included. */
export function archiveDoneTaskRows(projectId: string, doneStatus: TaskStatus): number {
  return db
    .update(schema.tasks)
    .set({ archived: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        eq(schema.tasks.status, doneStatus),
        eq(schema.tasks.archived, false),
      ),
    )
    .run().changes;
}
