// MANUAL moves of a task: which destinations the page may offer. A rule, not drawing: the server
// refuses some transitions and the screen must not offer a button that returns an error.
import { type Task } from "../api/tasks.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";
import { TASK_STATUS } from "../api/tasks.js";

/** In board order. Labels are the column titles: the control names the DESTINATION, not the enum
 *  value. `doing` is absent: a task is not put "in progress" by hand, a session does that. */
const MOVES: readonly (readonly [Task["status"], string])[] = [
  [TASK_STATUS.later, TASK_PAGE_TEXT.move.targets.later],
  [TASK_STATUS.todo, TASK_PAGE_TEXT.move.targets.todo],
  [TASK_STATUS.review, TASK_PAGE_TEXT.move.targets.review],
  [TASK_STATUS.done, TASK_PAGE_TEXT.move.targets.done],
];

/** "Later" only connects with `todo`, the server refuses the rest. A task in progress, in review or
 *  done cannot be postponed: its started work would be left without an owner. */
export function allowedMove(from: Task["status"], to: Task["status"]): boolean {
  if (to === TASK_STATUS.later) return from === TASK_STATUS.todo;
  if (from === TASK_STATUS.later) return to === TASK_STATUS.todo;
  return true;
}

/** Never the current destination, never a transition the server would refuse. */
export function moveOptions(from: Task["status"]): readonly (readonly [Task["status"], string])[] {
  return MOVES.filter(([s]) => s !== from && allowedMove(from, s));
}
