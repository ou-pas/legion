// A task's human edit, `PATCH /api/tasks/:id`, outside the route (06/09).
//
// One body, three unlike families: status and archiving (which finish, release blockers and wake
// sleepers), the brief (not rewritten under a live session), and settings (which already have their
// modules, `task-edit.ts` and `task-blocker-edit.ts`). This file orchestrates them and reimplements
// none.
//
// Why here rather than in the route: it was the 104-line body of the `app.patch` callback, so the
// only way to exercise it was mounting a Hono app. Its guards (status transition, a step only
// finished by batch approval, archiving reserved to finished work) deserve their own tests.
import { taskLiveSessions } from "../projects/purge.js";
import { onTaskDone, settleDone } from "../chains/templates.js";
import { lotApprovalOnly } from "../chains/slices.js";
import type { schema } from "../shared/db.js";
import { statusTransitionError, TASK_STATUS, type TaskStatus } from "./lifecycle.js";
import { applyTaskEdit, type TaskEdit } from "./task-edit.js";
import { applyBlockerEdit } from "./task-blocker-edit.js";
import { chooseTaskRunner } from "./task-runner-choice.js";
import { findTask } from "./task-reads-store.js";
import { writeStatusArchivedDescription } from "./task-patch-store.js";
import type { PatchTaskBody } from "./schemas.js";

type TaskRow = typeof schema.tasks.$inferSelect;
type LiveSession = { id: string; status: string };

export type PatchRefusal = {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  live?: LiveSession[];
};
export type PatchResult = { ok: true; task: TaskRow } | PatchRefusal;

const NOTHING_TO_PATCH =
  "status, archived, description or a setting (name/agentId/approvalGate/readOnly/complexity/priority/" +
  "modelOverride/chosenRunnerId/addBlockerIds/removeBlockerIds) required";

/** Applies the edit, or refuses naming the block. Order matters: everything is refused before
 *  anything is written, so a mixed PATCH (a setting + a forbidden status) does not leave half its
 *  effect behind. */
export function applyTaskPatch(taskId: string, body: PatchTaskBody): PatchResult {
  if (Object.values(body).every((v) => v === undefined))
    return { ok: false, status: 400, error: NOTHING_TO_PATCH };

  const before = findTask(taskId);
  // Otherwise the update touches 0 rows and returns 200 with a null body.
  if (!before) return { ok: false, status: 404, error: "task not found" };

  const refusal = refuseCore(before, body);
  if (refusal) return refusal;

  // Structural settings go through their own module, which carries the editability guard (not
  // started, no live session, not a demo project).
  const settings = settingsOf(body);
  if (Object.keys(settings).length > 0) {
    const edited = applyTaskEdit(taskId, settings);
    if (!edited.ok) return edited;
  }
  // The chosen runner (v66) has its own module and its own guard, the brief's rather than the
  // settings': it changes between two sessions, including on a `doing` task that just failed, which
  // is the field's very use (task-runner-choice.ts).
  if (body.chosenRunnerId !== undefined) {
    const chosen = chooseTaskRunner(taskId, body.chosenRunnerId);
    if (!chosen.ok) return chosen;
  }
  // Same pattern for blockers, and the same guard.
  if (body.addBlockerIds !== undefined || body.removeBlockerIds !== undefined) {
    const linked = applyBlockerEdit(taskId, {
      add: body.addBlockerIds,
      remove: body.removeBlockerIds,
    });
    if (!linked.ok) return linked;
  }

  const finishing = body.status === TASK_STATUS.done && before.status !== TASK_STATUS.done;
  const released = writeCore(taskId, body, finishing);
  if (finishing) onTaskDone(taskId, released);

  const after = findTask(taskId);
  if (!after) return { ok: false, status: 404, error: "task not found" };
  return { ok: true, task: after };
}

/** The three refusals about status, archiving and brief, returned before any write (see the order
 *  explained above). */
function refuseCore(before: TaskRow, body: PatchTaskBody): PatchRefusal | null {
  // The brief is what the agent was asked (`runner/manager.ts` builds it from `description`).
  // Rewriting it while a session runs would change nothing for it (its container already got its
  // spec), but the screen would lie about the instruction received. So refuse while a session works;
  // between two sessions, amend then rerun is legitimate.
  if (body.description !== undefined) {
    const live = taskLiveSessions(before.id);
    const [first] = live;
    if (first)
      return {
        ok: false,
        status: 409,
        error: `session ${first.status} in flight: its brief has already gone out, it does not get rewritten afterwards`,
        live,
      };
  }

  const status = body.status;
  if (status !== undefined) {
    // Transition rule shared with the Kanban move (task-move.ts); see its doc in lifecycle.ts:
    // `later` only connects with `todo`.
    const transition = statusTransitionError(before.status as TaskStatus, status);
    if (transition) return { ok: false, status: 400, error: transition };
    // A step approving a batch only finishes through that approval (behaviour 5): the page's
    // "finish" button is another path, refused like the rest.
    if (status === TASK_STATUS.done) {
      const lotOnly = lotApprovalOnly(before);
      if (lotOnly) return { ok: false, status: 400, error: lotOnly };
    }
  }

  // Only finished work is archived: an archived todo/doing task would stay drivable by chains while
  // invisible (review 5b #8).
  if (body.archived === true && (status ?? before.status) !== TASK_STATUS.done)
    return { ok: false, status: 400, error: "only a done task can be archived" };

  return null;
}

/** What goes to `applyTaskEdit`, copied field by field rather than spread, so a key the schema gains
 *  one day does not get in here without a decision. */
function settingsOf(body: PatchTaskBody): TaskEdit {
  const edit: TaskEdit = {};
  if (body.name !== undefined) edit.name = body.name;
  if (body.agentId !== undefined) edit.agentId = body.agentId;
  if (body.approvalGate !== undefined) edit.approvalGate = body.approvalGate;
  if (body.readOnly !== undefined) edit.readOnly = body.readOnly;
  if (body.complexity !== undefined) edit.complexity = body.complexity;
  if (body.priority !== undefined) edit.priority = body.priority;
  if (body.modelOverride !== undefined) edit.modelOverride = body.modelOverride;
  return edit;
}

/** Status, archiving and brief, plus consuming blocker links, in one transaction (`settleDone`,
 *  behaviour 8: "decided in the transaction that finishes each blocker"). Follow-ups (wake-ups,
 *  launching released tasks) run afterwards, outside it. Returns the released tasks, empty when
 *  nothing finishes.
 *
 *  Both decisions stay here, not in the store: postponing (`later`) takes the task out of the queue
 *  (`queued` set to `false`), and only a patch that finishes the task triggers `settleDone`. The
 *  store writes `queued` as given and calls `onFinish` without judging it. */
function writeCore(taskId: string, body: PatchTaskBody, finishing: boolean): string[] {
  const { status, archived, description } = body;
  return writeStatusArchivedDescription(
    taskId,
    {
      status,
      archived,
      description,
      // Postponing means leaving the queue. The missing gesture: once `queued`, nothing reset the
      // flag, so one could only wait for the task to start or delete it.
      queued: status === TASK_STATUS.later ? false : undefined,
    },
    () => (finishing ? settleDone(taskId) : []),
  );
}
