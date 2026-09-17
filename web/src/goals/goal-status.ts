// A goal's state as DRAWN, in the domain rather than a screen, like `tasks/task-status.ts`. The table
// lived in `GoalsPage.tsx` and the goal page imported it FROM the list: one screen depending on the
// other for a colour table neither owns.
import { type Goal, GOAL_STATUS } from "../api/goals.js";
import type { ChipState } from "../ui/chip.js";

/** Exhaustive Record: a missing entry would be a blank on screen, not an error. `cancelled` (the
 *  operator's stop) is neutral, not red: nothing broke, which separates it from `failed`, set only
 *  by the loop when it can no longer progress. */
export const GOAL_CHIP: Record<Goal["status"], ChipState> = {
  [GOAL_STATUS.draft]: "idle",
  [GOAL_STATUS.active]: "run",
  [GOAL_STATUS.paused]: "wait",
  [GOAL_STATUS.completed]: "ok",
  [GOAL_STATUS.stoppedStuck]: "bad",
  [GOAL_STATUS.stoppedBudget]: "bad",
  [GOAL_STATUS.stoppedTime]: "bad",
  [GOAL_STATUS.failed]: "bad",
  [GOAL_STATUS.cancelled]: "idle",
};
