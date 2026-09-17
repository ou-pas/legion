// Task status as the DRAWING sees it, owned by the domain and not the primitive, like
// `sessions/session-status.ts`. The table used to be private to `goals/GoalPage.tsx`: the second
// screen wanting a task status chip would have copied it, and two copies drift apart.
import { type Task } from "../api/tasks.js";
import type { ChipState } from "../ui/chip.js";

/** Exhaustive Record: a missing entry would be a blank on screen, not an error. */
export const TASK_CHIP: Record<Task["status"], ChipState> = {
  later: "idle",
  todo: "idle",
  doing: "run",
  review: "gate",
  done: "ok",
};
