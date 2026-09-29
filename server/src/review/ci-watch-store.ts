// Database access for the red-CI watcher: raw rows and one upsert. The decision (what a state
// means, what to do about it) is `ci-watch.ts`; the orchestration (probing the forge, calling
// `fixCi`, writing back) is `ci-watch-tick.ts`.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import type { CiWatchState } from "./ci-watch.js";

export type TaskRow = typeof schema.tasks.$inferSelect;

/** A `review` task next to the two project flags `ciWatchEnabledFor` needs — one query, no N+1 over
 *  the fleet's tasks. Filtering by those flags is a domain call (`ciWatchEnabledFor`), not written
 *  into this `WHERE`, so the rule stays in one place and stays testable without a database. */
export function tasksInReviewWithProjectFlags(): {
  task: TaskRow;
  project: { ciWatch: boolean; demo: boolean };
}[] {
  return db
    .select({
      task: schema.tasks,
      project: { ciWatch: schema.projects.ciWatch, demo: schema.projects.demo },
    })
    .from(schema.tasks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
    .where(eq(schema.tasks.status, TASK_STATUS.review))
    .all();
}

/** This PR's counter, or `null` for one never seen red (the caller defaults to
 *  `INITIAL_CI_WATCH_STATE`). */
export function ciWatchStateRow(
  taskId: string,
  repoName: string,
  number: number,
): CiWatchState | null {
  const row = db
    .select({ attempts: schema.ciWatchState.attempts, notified: schema.ciWatchState.notified })
    .from(schema.ciWatchState)
    .where(
      and(
        eq(schema.ciWatchState.taskId, taskId),
        eq(schema.ciWatchState.repoName, repoName),
        eq(schema.ciWatchState.number, number),
      ),
    )
    .get();
  return row ?? null;
}

/** Writes this PR's counter, creating the row on its first red. One key, one row: a later `fixCi`
 *  from the operator's own click reads the same counter next tick, nothing to reconcile. */
export function saveCiWatchState(
  taskId: string,
  repoName: string,
  number: number,
  state: CiWatchState,
  now: Date,
): void {
  db.insert(schema.ciWatchState)
    .values({
      taskId,
      repoName,
      number,
      attempts: state.attempts,
      notified: state.notified,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.ciWatchState.taskId,
        schema.ciWatchState.repoName,
        schema.ciWatchState.number,
      ],
      set: { attempts: state.attempts, notified: state.notified, updatedAt: now },
    })
    .run();
}
