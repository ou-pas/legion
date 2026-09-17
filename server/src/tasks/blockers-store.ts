// The only code touching `task_blockers` in the database. No business `if` here: the guards
// (`validateBlockerLinks`), the cycle walk (`reachableThroughDependents`) and the release rule
// (`releaseDependentsOf`: "the last blocker to finish releases, exactly once") stay in
// `blockers.ts`. `heldBy`, `deleteBlockersFrom` and `blockedAmong` are its three named queries,
// which do not decide among themselves what is released.
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import type { TaskStatus } from "./lifecycle.js";

/** A blocker with what it takes to name it: the launch refusal, the card and the page need it.
 *  `status` is the schema union, not `string`: the screen indexes a label table with it, and a
 *  `string` would have let through to the DOM a value the database never produces. */
export type BlockerRef = { id: string; name: string; status: TaskStatus };

/** The handle a writer inserts through: bare `db`, or the caller's Drizzle transaction. Structural
 *  (the only member used) rather than Drizzle's class: `db` and `tx` inherit `insert` from the same
 *  parent, and that is all we ask. */
type Writer = Pick<typeof db, "insert">;

/** Sets a link. Idempotent, as "setting the column" was: restating a block is not a fault. Both
 *  tasks must exist (FK).
 *
 *  `tx` (05/09): a caller already in a transaction passes its own, so the link lands there by
 *  construction. The link used to go through `db`, relying on `db` and `tx` being the same
 *  better-sqlite3 handle: true, but a property of the library, not of the code; another driver
 *  would have broken it without a line changing here. */
export function addBlocker(taskId: string, blockerId: string, tx: Writer = db): void {
  tx.insert(schema.taskBlockers)
    .values({ taskId, blockerId, createdAt: new Date() })
    .onConflictDoNothing()
    .run();
}

/** The blockers still holding this task. The edge side is in the name: `blockersOf` and
 *  `consumeBlockersOf` take the held task, `releaseDependentsOf` the holding one; three bare
 *  `string` ids, so swapped arguments compile. */
export function blockersOf(taskId: string): string[] {
  return db
    .select({ blockerId: schema.taskBlockers.blockerId })
    .from(schema.taskBlockers)
    .where(eq(schema.taskBlockers.taskId, taskId))
    .all()
    .map((r) => r.blockerId);
}

/** The other side of the edge: the tasks this one still holds. Batch approval uses it to find the
 *  next step without naming it (slice 06); a step the operator already moved to done is no longer
 *  there, its link consumed at that moment. */
export function dependentsOf(blockerId: string): string[] {
  return db
    .select({ taskId: schema.taskBlockers.taskId })
    .from(schema.taskBlockers)
    .where(eq(schema.taskBlockers.blockerId, blockerId))
    .orderBy(schema.taskBlockers.createdAt, schema.taskBlockers.taskId)
    .all()
    .map((r) => r.taskId);
}

/** Each task's named blockers, in one query for the whole batch: the board list serialises dozens of
 *  tasks, and a query per card would be the defect `serializeTasks` avoids for sessions. With no
 *  argument, the whole table. Order: insertion, then id, stable for the screen and tests. */
export function blockersByTask(taskIds?: string[]): Map<string, BlockerRef[]> {
  const out = new Map<string, BlockerRef[]>();
  // `inArray` on an empty list produces invalid SQL: nothing to ask, nothing to return.
  if (taskIds && taskIds.length === 0) return out;
  const rows = db
    .select({
      taskId: schema.taskBlockers.taskId,
      id: schema.tasks.id,
      name: schema.tasks.name,
      status: schema.tasks.status,
    })
    .from(schema.taskBlockers)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskBlockers.blockerId))
    .where(taskIds ? inArray(schema.taskBlockers.taskId, taskIds) : undefined)
    .orderBy(schema.taskBlockers.createdAt, schema.taskBlockers.blockerId)
    .all();
  for (const r of rows) {
    const list = out.get(r.taskId);
    const ref = { id: r.id, name: r.name, status: r.status };
    if (list) list.push(ref);
    else out.set(r.taskId, [ref]);
  }
  return out;
}

/** Tasks at least one link holds. For filters scanning all of `todo` (queue, scheduler): a set read
 *  once, not a query per candidate. */
export function blockedTaskIds(): Set<string> {
  return new Set(
    db
      .selectDistinct({ taskId: schema.taskBlockers.taskId })
      .from(schema.taskBlockers)
      .all()
      .map((r) => r.taskId),
  );
}

/** Tasks `blockerId` still holds: what `releaseDependentsOf` (`blockers.ts`) decides to release or
 *  not once this blocker is consumed. */
export function heldBy(blockerId: string): string[] {
  return db
    .select({ taskId: schema.taskBlockers.taskId })
    .from(schema.taskBlockers)
    .where(eq(schema.taskBlockers.blockerId, blockerId))
    .all()
    .map((r) => r.taskId);
}

/** Consumes every link where `blockerId` is the blocker: a blocker's done (or disappearance). Says
 *  nothing of what that releases; see `releaseDependentsOf` (`blockers.ts`). */
export function deleteBlockersFrom(blockerId: string): void {
  db.delete(schema.taskBlockers).where(eq(schema.taskBlockers.blockerId, blockerId)).run();
}

/** Among `taskIds`, those at least one blocker still holds. One query for the whole batch rather
 *  than one per task: a batch's Wiki step has as many blockers as slices, and each done re-scanned
 *  the list. */
export function blockedAmong(taskIds: readonly string[]): Set<string> {
  if (taskIds.length === 0) return new Set();
  return new Set(
    db
      .select({ taskId: schema.taskBlockers.taskId })
      .from(schema.taskBlockers)
      .where(inArray(schema.taskBlockers.taskId, [...taskIds]))
      .all()
      .map((r) => r.taskId),
  );
}

/** Consumes the links blocking this task: it becomes done or disappears, so what held it no longer
 *  counts. */
export function consumeBlockersOf(taskId: string): void {
  db.delete(schema.taskBlockers).where(eq(schema.taskBlockers.taskId, taskId)).run();
}

/** Removes one link, `taskId` → `blockerId`. The table's fifth writer (next to the four internal ones
 *  listed at the top of `blockers.ts`), added for `PATCH /api/tasks/:id` (`task-blocker-edit.ts`): an
 *  operator who set a link by mistake must be able to undo it without taking the others;
 *  `consumeBlockersOf` erases all of a task's blockers. Idempotent like `addBlocker`: removing an
 *  absent link is not a fault. */
export function removeBlocker(taskId: string, blockerId: string): void {
  db.delete(schema.taskBlockers)
    .where(
      and(eq(schema.taskBlockers.taskId, taskId), eq(schema.taskBlockers.blockerId, blockerId)),
    )
    .run();
}

/** Candidate tasks for a link (id, name, status, project), for `validateBlockerLinks`'s guards:
 *  existence, project, status already `done`. */
export function candidateTasksByIds(
  ids: string[],
): { id: string; name: string; status: TaskStatus; projectId: string }[] {
  if (ids.length === 0) return [];
  return db
    .select({
      id: schema.tasks.id,
      name: schema.tasks.name,
      status: schema.tasks.status,
      projectId: schema.tasks.projectId,
    })
    .from(schema.tasks)
    .where(inArray(schema.tasks.id, ids))
    .all();
}
