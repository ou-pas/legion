// A batch refusal, written into the task's activity feed ("decoupe" spec, behaviour 6).
//
// Separate from `slices.ts` for one reason: the session brief reads it, and `slices.ts` depends on
// `templates.ts`, which depends on the runner. Importing it from the runner would close a cycle
// runner → slices → templates → runner.
//
// `task_activity` has no kind column, and adding one for a single writer would be a migration for
// a prefix. A refusal is therefore recognised by its first word.
import { nanoid } from "nanoid";
import { insertTaskActivity, taskActivityNewestFirst } from "./lot-refusal-store.js";
import { ACTIVITY_FROM } from "../tasks/activity-enums.js";

export const LOT_REFUSED = "lot_refused";

/** The row body: the word that identifies it, then one fault per line. */
export function refusalBody(faults: readonly string[]): string {
  return `${LOT_REFUSED}: batch refused, nothing was created.\n${faults.map((f) => `- ${f}`).join("\n")}`;
}

export function isRefusal(entry: { from: string; body: string }): boolean {
  return entry.from === ACTIVITY_FROM.system && entry.body.startsWith(LOT_REFUSED);
}

/** Written one fault per line so the operator can read it on the page and the agent's rerun finds
 *  it in its brief. */
export function recordLotRefusal(taskId: string, faults: readonly string[]): void {
  insertTaskActivity({
    id: nanoid(10),
    taskId,
    from: ACTIVITY_FROM.system,
    body: refusalBody(faults),
    createdAt: new Date(),
  });
}

/** The latest batch refusal for this task, verbatim, or `null`. A slicer rerun without it would
 *  drop the same artifact and be refused identically. */
export function lastLotRefusal(taskId: string): string | null {
  return taskActivityNewestFirst(taskId).find(isRefusal)?.body ?? null;
}
