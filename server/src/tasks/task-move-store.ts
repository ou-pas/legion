// No business `if` here: the rank policy lives in `decidePlacement` (task-move.ts), received as a
// parameter; this module reads and writes what it decides, as `lifecycle-store.ts` receives
// `requireStatusIn` or `purge-store.ts` receives `onBeforeDelete`.
//
// The whole transaction lives here, the siblings read included, not only the final `UPDATE`. The
// task read inside must see a state as fresh as the siblings it compares (a concurrent move may
// have passed between `task-move.ts`'s read and this transaction; better-sqlite3 serialises
// transactions, not reads outside them). Separating the read feeding the decision from the
// transaction would break that freshness, hence `decidePlacement` and `onWritten` passed in rather
// than called by `task-move.ts` before entering here.
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "../shared/db.js";
import { applyTaskTransition, decidedMove, type TaskStatus } from "./lifecycle.js";

export type TaskRow = typeof schema.tasks.$inferSelect;

export function findTaskRow(taskId: string): TaskRow | undefined {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
}

/** A column's tasks (project + status), sorted by rank then id (stable tie-break while two ranks are
 *  still equal, e.g. rows never moved since the v21 backfill, or seeded without an explicit rank). */
function columnRows(projectId: string, status: TaskStatus, excludeTaskId: string): TaskRow[] {
  return db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        eq(schema.tasks.status, status),
        ne(schema.tasks.id, excludeTaskId),
      ),
    )
    .all()
    .sort((a, b) => a.boardOrder - b.boardOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type PlacementDecision = {
  newOrder: number;
  rebalanced: boolean;
  /** Siblings whose rank really changes, non-empty only when `rebalanced` is true.
   *  `moveWithinColumn` writes nothing beyond this list. */
  resequenced: { id: string; boardOrder: number }[];
};

export type MoveWrite =
  | { found: true; task: TaskRow; rebalanced: boolean; released: string[] | null }
  | { found: false };

export type PlacementRequest = {
  index: number;
  gap: number;
  /** Pure, supplied by the caller: decides the rank and any fallback from the freshly read column. */
  decide: (
    siblings: readonly TaskRow[],
    index: number,
    current: TaskRow,
    gap: number,
  ) => PlacementDecision;
};

/** Moves `taskId` to `status`/`placement.index`: `placement.decide` decides the rank and any
 *  fallback from the freshly read column; `onWritten` (supplied by the caller) decides what follows
 *  once the transition is set and receives the fresh row from before the write, all in the same
 *  transaction (see the file header). */
export function moveWithinColumn(
  taskId: string,
  status: TaskStatus,
  placement: PlacementRequest,
  onWritten: (current: TaskRow) => string[] | null,
): MoveWrite {
  return db.transaction((): MoveWrite => {
    // Re-read inside the transaction: see the file header.
    const current = findTaskRow(taskId);
    if (!current) return { found: false };

    const siblings = columnRows(current.projectId, status, taskId);
    const { newOrder, rebalanced, resequenced } = placement.decide(
      siblings,
      placement.index,
      current,
      placement.gap,
    );
    for (const row of resequenced)
      db.update(schema.tasks)
        .set({ boardOrder: row.boardOrder })
        .where(eq(schema.tasks.id, row.id))
        .run();

    // The target is the drop's, already judged by the caller's `statusTransitionError`:
    // `decidedMove` routes the write through the table without adding a second filter.
    applyTaskTransition(taskId, decidedMove(status), { boardOrder: newOrder });

    const released = onWritten(current);

    const moved = findTaskRow(taskId);
    if (!moved) throw new Error(`task “${taskId}” vanished during its own move`);
    return { found: true, task: moved, rebalanced, released };
  });
}
