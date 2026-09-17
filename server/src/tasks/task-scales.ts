// A task's two scales, spelled the same, which is the whole point of naming them: `low | med | high`
// means complexity or priority depending on the column, and a literal does not say which. An
// automatic replacement cannot tell them apart; two constants can.
//
// They do not mix in what they decide either:
//   · complexity routes the model (low → haiku, high → opus, med → the project's chain);
//   · priority orders pickup (queue, goal spawns, board, scheduler).
// One is about the work's difficulty, the other about its turn. A simple, urgent task is perfectly
// coherent.
import type { schema } from "../shared/db.js";

/** Routes the model. `med` is not an arithmetic middle: it means "follow the project's resolution
 *  chain" (see models/model.ts:resolveModel). */
export type Complexity = (typeof schema.tasks.$inferSelect)["complexity"];
export const COMPLEXITY = {
  low: "low",
  med: "med",
  high: "high",
} as const satisfies Record<string, Complexity>;
export const COMPLEXITIES = [COMPLEXITY.low, COMPLEXITY.med, COMPLEXITY.high] as const;

/** Orders pickup, never the model. Two tasks of equal priority go by age. */
export type Priority = (typeof schema.tasks.$inferSelect)["priority"];
export const PRIORITY = {
  low: "low",
  med: "med",
  high: "high",
} as const satisfies Record<string, Priority>;
export const PRIORITIES = [PRIORITY.low, PRIORITY.med, PRIORITY.high] as const;
