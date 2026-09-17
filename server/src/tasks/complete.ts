// Finishing a task programmatically: the same transition as the operator's button (PATCH status:
// done), extracted for the first caller that is not a route, a forge's inbound webhook (webhooks
// batch, 03/09). The transition already existed in three copies (task routes, task-move.ts,
// sessions/internal-routes.ts), each with a transaction carrying other writes. They are not
// refactored here (debt noted in the spec), but no fourth copy is born: new callers use this door.
//
// Guards are the routes', in the same order: legal transition (`statusTransitionError`), a batch
// step cannot be short-circuited (`lotApprovalOnly`). The refusal spells out its reason; the caller
// decides whether it is an error (operator) or a no-op (webhook replayed on an already done task).
import { lotApprovalOnly } from "../chains/slices.js";
import { onTaskDone, settleDone } from "../chains/templates.js";
import { findTaskRow, withTransaction } from "./complete-store.js";
import {
  applyTaskTransition,
  decidedMove,
  statusTransitionError,
  type TaskStatus,
} from "./lifecycle.js";
import { TASK_STATUS } from "./lifecycle.js";

export type CompleteResult =
  | { ok: true; released: string[] }
  | { ok: false; reason: string; alreadyDone: boolean };

export function completeTask(taskId: string, note?: string): CompleteResult {
  const task = findTaskRow(taskId);
  if (!task) return { ok: false, reason: "task not found", alreadyDone: false };
  if (task.status === TASK_STATUS.done)
    return { ok: false, reason: "already done", alreadyDone: true };

  const transition = statusTransitionError(task.status as TaskStatus, TASK_STATUS.done);
  if (transition) return { ok: false, reason: transition, alreadyDone: false };
  const lotOnly = lotApprovalOnly(task);
  if (lotOnly) return { ok: false, reason: lotOnly, alreadyDone: false };

  // The status read above is restated in the WHERE: if the task moved between read and write (the
  // operator clicking while the webhook rings), the update touches zero rows and nothing is
  // consumed. Same race closure as task-edit.ts.
  const released = withTransaction(() => {
    const moved = applyTaskTransition(
      taskId,
      decidedMove(TASK_STATUS.done, [task.status as TaskStatus]),
    );
    return moved ? settleDone(taskId) : null;
  });
  if (released === null)
    return { ok: false, reason: "the task changed state in the meantime", alreadyDone: false };

  onTaskDone(taskId, released, note);
  return { ok: true, released };
}
