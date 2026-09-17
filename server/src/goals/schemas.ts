// What a client may send to the goal routes (06/09).
//
// Same move as `sessions/internal-schemas.ts`: `c.req.json<T>()` checked nothing, the `<T>` is a
// disguised `as`. The client here is the screen, so the risk is drift, not malice: a field renamed
// on the web side kept leaving under its old name, the route read `undefined`, and the goal was
// created without its budget cap and without any visible refusal.
//
// `strictObject` everywhere: an unknown key is refused by name. Silently dropping it would let the
// caller believe the request was heard as sent.
//
// Schemas describe the shape and stop there. What needs the database or the goal's state (still
// editable? does the agent exist?) stays in `goal-edit.ts`, which names it better than a type would.
import { z } from "zod";

/** A goal's rails, shared by create and edit. `null` is a value ("no cap"), not an absence: it is
 *  what removes a budget already set. */
const budgetUsd = z.number().nullable().optional();
const maxHours = z.number().nullable().optional();
const maxNoProgress = z.number().int().optional();

/** A sentence the human wrote: trimmed here, and empty is refused, since a goal without a name or
 *  request has nothing to generate. */
const filled = z.string().trim().min(1);

/** POST /api/goals */
export const createGoalBody = z.strictObject({
  projectId: z.string().min(1),
  name: filled,
  request: filled,
  allowedAgentIds: z.array(z.string()).optional(),
  budgetUsd,
  maxHours,
  maxNoProgress,
});

/** PATCH /api/goals/:id: everything is optional, `goal-edit.ts` refuses the empty patch by name. */
export const goalPatchBody = z.strictObject({
  name: z.string().optional(),
  request: z.string().optional(),
  allowedAgentIds: z.array(z.string()).optional(),
  budgetUsd,
  maxHours,
  maxNoProgress,
});

/** POST /api/goals/:id/approve: the DoD the human just reviewed. */
export const approveGoalBody = z.strictObject({
  items: z.array(z.strictObject({ id: z.string(), text: z.string() })),
});

/** POST /api/goals/from-issues */
export const goalFromIssuesBody = z.strictObject({
  projectId: z.string().min(1),
  name: z.string().optional(),
  issues: z
    .array(z.strictObject({ identifier: z.string(), title: z.string(), url: z.string() }))
    .min(1),
  budgetUsd,
});
