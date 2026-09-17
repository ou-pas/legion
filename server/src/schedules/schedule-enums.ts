// What a scheduled run produced. Three of the four outcomes are not errors: a disabled rule and a
// missed tick are recorded so "why did nothing happen last night?" has an answer. Treating them as
// `error` would alarm on normal silence and drown real errors in noise.
import type { schema } from "../shared/db.js";

export type ScheduleOutcome = (typeof schema.scheduleRuns.$inferSelect)["outcome"];
export const SCHEDULE_OUTCOME = {
  /** `task_id` names the created task. */
  taskCreated: "task-created",
  skippedDisabled: "skipped-disabled",
  /** The time passed with no tick to see it (control plane stopped). No catch-up: a task created
   *  three hours late is worth less than nothing. */
  skippedMissed: "skipped-missed",
  /** `reason` carries the sentence. */
  error: "error",
} as const satisfies Record<string, ScheduleOutcome>;
export const SCHEDULE_OUTCOMES = [
  SCHEDULE_OUTCOME.taskCreated,
  SCHEDULE_OUTCOME.skippedDisabled,
  SCHEDULE_OUTCOME.skippedMissed,
  SCHEDULE_OUTCOME.error,
] as const;
