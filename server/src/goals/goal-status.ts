// A goal's nine statuses, named. Same shape as `SESSION_STATUS` and `TASK_STATUS`: the key carries
// the concept, the value the serialisation.
//
// This family was already renamed once: on 03/09, v54 split `cancelled` from `failed` because the
// kill switch wrote the same status as a broken loop, so the goal list could not tell "I changed my
// mind" from "it broke". Another rename will cost one line.
//
// Separate from `goals.ts` (the loop) on purpose: the screen, routes, purge and tests read this
// list and should not drag the orchestrator along.
import type { schema } from "../shared/db.js";

/** The type comes from the column: a status added to the schema without a name here will not compile. */
export type GoalStatus = (typeof schema.goals.$inferSelect)["status"];

export const GOAL_STATUS = {
  /** Created, DoD generated, nothing runs: the loop only exists after human approval. */
  draft: "draft",
  active: "active",
  paused: "paused",
  completed: "completed",
  /** The three guardrail stops. They say which one cut: a cost cap and a stall are not fixed the
   *  same way. */
  stoppedStuck: "stopped-stuck",
  stoppedBudget: "stopped-budget",
  stoppedTime: "stopped-time",
  /** The loop broke (persistent orchestrator error, no allowed agent). */
  failed: "failed",
  /** The operator changed their mind (v54). Distinct from `failed`, which is the whole point. */
  cancelled: "cancelled",
} as const satisfies Record<string, GoalStatus>;

/** Lifecycle order, then endings. The screen indexes its chips and labels on it, so a new status
 *  without a colour shows. */
export const GOAL_STATUSES = [
  GOAL_STATUS.draft,
  GOAL_STATUS.active,
  GOAL_STATUS.paused,
  GOAL_STATUS.completed,
  GOAL_STATUS.stoppedStuck,
  GOAL_STATUS.stoppedBudget,
  GOAL_STATUS.stoppedTime,
  GOAL_STATUS.failed,
  GOAL_STATUS.cancelled,
] as const;

/** A live goal: the loop runs or will resume. Deletion (refuses to erase what runs) and launch
 *  (refuses to double a loop) both ask this. */
export const LIVE_GOAL_STATUSES: readonly GoalStatus[] = [GOAL_STATUS.active, GOAL_STATUS.paused];

/** Guardrail stops, as opposed to success, failure or cancellation. */
export const STOPPED_GOAL_STATUSES: readonly GoalStatus[] = [
  GOAL_STATUS.stoppedStuck,
  GOAL_STATUS.stoppedBudget,
  GOAL_STATUS.stoppedTime,
];

/** The endings the loop sets itself. `cancelled` is not one of them, which is the point of the
 *  distinction: it comes from the kill switch, so from the operator (v54). `draft`, `active` and
 *  `paused` are not endings. */
export const LOOP_END_STATUSES = [
  GOAL_STATUS.completed,
  GOAL_STATUS.stoppedStuck,
  GOAL_STATUS.stoppedBudget,
  GOAL_STATUS.stoppedTime,
  GOAL_STATUS.failed,
] as const;
export type LoopEndStatus = (typeof LOOP_END_STATUSES)[number];
