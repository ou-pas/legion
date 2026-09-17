// Kanban move (drag and drop): moves a task to a target column (its `status`) and a target position
// (its rank among that column's tasks), in one transaction.
//
// Strategy: fractional rank (`tasks.board_order`, REAL, v21), not dense integer resequencing.
//   · Insert between two placed siblings → new rank = their average. One row moves: the moved task.
//     No other task, even in the same column, is touched.
//   · Insert at the top or bottom of a column → new rank = sibling ± a fixed GAP.
//   · Fallback, only when two siblings got too close for a float to fit between them (precision
//     exhausted after many inserts at the same spot): a simple integer resequencing with gaps,
//     bounded to the target column only, never global.
// The fractional path covers the normal case (a move = 1 row written); integer resequencing only
// steps in as a rescue and stays local to the affected column.
//
// The rank policy (placement, possible fallback) lives here as a pure function (`decidePlacement`):
// it takes the already read column, returns a decision, never touches the database.
// `task-move-store.ts` only carries the fresh read and writing what this function decides. This file
// also validates input and carries the transition guards.
import { onTaskDone, settleDone } from "../chains/templates.js";
import { lotApprovalOnly } from "../chains/slices.js";
import { statusTransitionError, TASK_STATUSES, TASK_STATUS, type TaskStatus } from "./lifecycle.js";
import {
  findTaskRow,
  moveWithinColumn,
  type PlacementDecision,
  type TaskRow,
} from "./task-move-store.js";

/** Initial gap between neighbouring ranks on a resequencing (fallback) or a top/bottom insert. Large
 *  enough to absorb hundreds of successive inserts at the same spot before exhausting float
 *  precision. */
export const BOARD_ORDER_GAP = 1024;

/** Below this gap between two siblings, the float average is no longer trusted (it would end up
 *  rounding onto one bound): an integer fallback is required. */
const MIN_GAP = 1e-6;

export type MoveInput = { status: string; index: number };

export type MoveResult =
  | { ok: true; task: TaskRow; rebalanced: boolean }
  | { ok: false; status: 400 | 404; error: string };

/** Recomputes the column's integer ranks (fallback), moved task included. */
function resequence(
  siblings: readonly TaskRow[],
  index: number,
  current: TaskRow,
  gap: number,
): PlacementDecision {
  const finalOrder = [...siblings.slice(0, index), current, ...siblings.slice(index)];
  let newOrder = gap;
  const resequenced: { id: string; boardOrder: number }[] = [];
  for (const [i, row] of finalOrder.entries()) {
    const assigned = (i + 1) * gap;
    if (row.id === current.id) {
      newOrder = assigned;
      continue;
    }
    if (row.boardOrder !== assigned) resequenced.push({ id: row.id, boardOrder: assigned });
  }
  return { newOrder, rebalanced: true, resequenced };
}

/** The board's rank policy: where to put `current` among `siblings` (already sorted, moved task
 *  excluded) at the requested index, and whether float precision forces a fallback. An out-of-range
 *  `index` (past the column's end) is brought back to the bottom: a client whose cache lags the
 *  server by one keystroke is still a legitimate drop, not an error (see `applyTaskMove`). Pure:
 *  never touches the database. */
export function decidePlacement(
  siblings: readonly TaskRow[],
  index: number,
  current: TaskRow,
  gap: number,
): PlacementDecision {
  const boundedIndex = Math.min(index, siblings.length);
  const before = boundedIndex > 0 ? (siblings.at(boundedIndex - 1) ?? null) : null;
  const after = siblings.at(boundedIndex) ?? null;

  if (before && after && after.boardOrder - before.boardOrder < MIN_GAP)
    return resequence(siblings, boundedIndex, current, gap);
  if (before && after)
    return {
      newOrder: (before.boardOrder + after.boardOrder) / 2,
      rebalanced: false,
      resequenced: [],
    };
  if (before && !after)
    return { newOrder: before.boardOrder + gap, rebalanced: false, resequenced: [] }; // bottom of column
  if (!before && after)
    return { newOrder: after.boardOrder - gap, rebalanced: false, resequenced: [] }; // top of column
  return { newOrder: gap, rebalanced: false, resequenced: [] }; // empty column (apart from the moved task)
}

/** Moves `taskId` to `input.status`/`input.index` (0-based, among tasks already in the target
 *  column, moved task excluded). An out-of-range `index` is simply bounded (top/bottom drop) rather
 *  than refused. */
export function applyTaskMove(taskId: string, input: MoveInput): MoveResult {
  if (!Number.isInteger(input.index) || input.index < 0)
    return {
      ok: false,
      status: 400,
      error: `invalid index: “${input.index}” (integer ≥ 0 expected)`,
    };
  if (!(TASK_STATUSES as readonly string[]).includes(input.status))
    return { ok: false, status: 400, error: `invalid status: “${input.status}”` };
  const status = input.status as TaskStatus;

  const task = findTaskRow(taskId);
  if (!task) return { ok: false, status: 404, error: "task not found" };

  const transitionError = statusTransitionError(task.status as TaskStatus, status);
  if (transitionError) return { ok: false, status: 400, error: transitionError };

  // A drop into the Done column finishes a task just like the button, so the batch guard applies
  // here too (behaviour 5, "by any other path").
  if (status === TASK_STATUS.done) {
    const lotOnly = lotApprovalOnly(task);
    if (lotOnly) return { ok: false, status: 400, error: lotOnly };
  }

  const write = moveWithinColumn(
    taskId,
    status,
    { index: input.index, gap: BOARD_ORDER_GAP, decide: decidePlacement },
    // Same side effect as the PATCH route when a task reaches `done` (chain auto-chaining,
    // templates.ts). `current` is the fresh row the store re-reads in its transaction (see its doc):
    // a concurrent move may have passed between the read above and that transaction.
    (current) =>
      status === TASK_STATUS.done && current.status !== TASK_STATUS.done
        ? settleDone(taskId)
        : null,
  );
  if (!write.found) return { ok: false, status: 404, error: "task not found" };

  if (write.released) onTaskDone(taskId, write.released);
  return { ok: true, task: write.task, rebalanced: write.rebalanced };
}
