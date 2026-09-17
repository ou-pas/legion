// Choosing the machine that runs a task (v66, 09/09).
//
// The need came from an outage: the `local` runner had lost its session image, two tasks died, and
// the fleet had other machines that had it. The operator had no way to say "not that one, the
// other".
//
// Its editability rule is not the settings' one, and that is the heart of this module. Title,
// agent and complexity freeze once the task started (`EDITABLE_STATUSES`, task-edit.ts): a session
// saw them. The chosen runner follows the brief's rule (`isBriefEditable`): amend then rerun between
// two sessions is exactly the use that created the need. Only a live session freezes the choice,
// because it already reserved its place on a machine (`sessions.runner_id`): the new choice applies
// to the next ones, never to it.
//
// No race to close here, unlike `applyTaskEdit` which restates its guard in the `WHERE`. If a
// session starts between read and write, it leaves with the old choice and the new one applies to
// the next: exactly what this field promises.
import { taskLiveSessions } from "../projects/purge.js";
import type { schema } from "../shared/db.js";
import {
  findTaskRow,
  isDemoProject,
  runnerExists,
  setChosenRunner,
} from "./task-runner-choice-store.js";

type TaskRow = typeof schema.tasks.$inferSelect;

type RunnerChoiceResult =
  | { ok: true; task: TaskRow }
  | { ok: false; status: 400 | 404 | 409; error: string; live?: { id: string; status: string }[] };

/** Sets (or clears, with `null`) the machine designated for this task, or refuses naming the block.
 *  `null` is a full gesture: "the control plane decides", the long-standing default. */
export function chooseTaskRunner(
  taskId: string,
  chosenRunnerId: string | null,
): RunnerChoiceResult {
  const task = findTaskRow(taskId);
  if (!task) return { ok: false, status: 404, error: "task not found" };

  if (isDemoProject(task.projectId))
    return { ok: false, status: 409, error: "demo project: read only, nothing gets edited here" };

  // The runner is checked when set, as well as at launch: setting an id that designates nothing
  // would leave a task refusing to start without the screen having said anything.
  if (chosenRunnerId !== null && !runnerExists(chosenRunnerId))
    return { ok: false, status: 400, error: `runner not found: “${chosenRunnerId}”` };

  const live = taskLiveSessions(taskId);
  const [first] = live;
  if (first)
    return {
      ok: false,
      status: 409,
      error: `session ${first.status} in flight: it is already running on the machine it reserved — the choice will apply to the next one`,
      live,
    };

  const updated = setChosenRunner(taskId, chosenRunnerId);
  // Deleted between read and write: the 404 tells the truth, the write touched no row.
  if (!updated) return { ok: false, status: 404, error: "task not found" };
  return { ok: true, task: updated };
}
