// Which session statuses count as in flight is decided by `sessions/session-terminal.ts`
// (`ACTIVE_STATUSES`), received as a parameter; hard-coding the list here would repeat the defect
// fixed elsewhere (`manager-store.ts`).
//
// `applyBlockerChanges`'s two `if`s (`!still`, `live`) decide nothing new: they re-check inside the
// transaction a refusal `task-blocker-edit.ts` already made on read (`applyBlockerEdit`, via
// `blockerEditRefusal`), closing the race where the task is deleted or a session starts during the
// call. The verdict is not theirs; only its freshness is.
import { and, eq, inArray } from "drizzle-orm";
import { db, isDemoProject, schema } from "../shared/db.js";
import type { SessionStatus } from "../sessions/session-terminal.js";
import { addBlocker, removeBlocker } from "./blockers-store.js";

export { isDemoProject };

export function findTaskRow(taskId: string): typeof schema.tasks.$inferSelect | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

/** Adds/removes blockers, but nothing if a session in `liveStatuses` started in the meantime: the
 *  question is asked again inside the transaction (see `task-blocker-edit.ts`). Returns `false` when
 *  the race was lost; the caller then decides the refusal.
 *
 *  The race closed here is the one that matters, and it is a launch, no longer a status change
 *  (10/09): since `areBlockersEditable`, a `review` or `done` task is editable while no session
 *  runs, so restating the status proved nothing. */
export function applyBlockerChanges(
  taskId: string,
  add: string[],
  remove: string[],
  liveStatuses: readonly SessionStatus[],
): boolean {
  return db.transaction((tx) => {
    const still = tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();
    if (!still) return false;
    const live = tx
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(eq(schema.sessions.taskId, taskId), inArray(schema.sessions.status, [...liveStatuses])),
      )
      .get();
    if (live) return false;
    for (const id of add) addBlocker(taskId, id, tx);
    for (const id of remove) removeBlocker(taskId, id);
    if (add.length > 0 || remove.length > 0)
      db.update(schema.tasks)
        .set({ updatedAt: new Date() })
        .where(eq(schema.tasks.id, taskId))
        .run();
    return true;
  });
}
