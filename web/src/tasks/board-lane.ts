// The lane shown on a phone, remembered between visits (14/09). The compact board renders a single
// lane and used to reset to "doing" on every mount, so Todo, a task, back to the board landed on a
// different lane than the one just left (operator request).
//
// Per project, because two projects are not at the same point of their work: one is read in
// "Review", the other in "Later".
//
// `localStorage` and not the URL, although the URL survives "back" for free: the gesture described
// is tapping "Board" in the bottom bar, a fresh navigation without parameters. An address cannot
// remember what was not put in it.
//
// Unavailable storage (private browsing, browser settings) is not a failure: fall back on the
// default and let writes fail silently. A board refusing to render because it cannot remember would
// be worse than forgetting.
import { TASK_STATUS, type TaskStatus } from "../api/tasks.js";

const KEY = (projectId: string) => `legion.board.lane.${projectId}`;

/** On a phone the question is what runs now, not what might be noted someday. Exported so that the
 *  board and this module do not each keep their own. */
export const DEFAULT_LANE: TaskStatus = TASK_STATUS.doing;

/** Accepted values. A string read back from storage is not trusted: it may date from a version where
 *  the lane had another name, or have been written by hand. Without this filter the board would
 *  render an empty column with nothing saying why. */
const LANES: readonly TaskStatus[] = [
  TASK_STATUS.later,
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.done,
];

export function readLane(projectId: string | null | undefined): TaskStatus {
  if (!projectId) return DEFAULT_LANE;
  try {
    const stored = localStorage.getItem(KEY(projectId));
    return LANES.find((l) => l === stored) ?? DEFAULT_LANE;
  } catch {
    return DEFAULT_LANE;
  }
}

export function writeLane(projectId: string | null | undefined, lane: TaskStatus): void {
  if (!projectId) return;
  try {
    localStorage.setItem(KEY(projectId), lane);
  } catch {
    /* storage unavailable: the lane falls back on the default next time, nothing more */
  }
}
