// What a runtime may send: one schema per mutating `/internal` body (05/09).
//
// The hole they close: `c.req.json<T>()` checked nothing, and the inbox route passed the body into
// `createInboxMessage` with `{ ...body }`. That spread carried ANY key the agent set, declared or
// not, and the service reads three no agent may set: `reason` (an agent-posted `operator-pause` made
// `NOTIF_BY_REASON` null, so NO notification: the agent chose whether to disturb the human),
// `waitForTaskId` (a wait without `requestWaitForTask`'s guardrails: cycle, project boundary, one at
// a time) and `wakeAt` (a string where a Date is expected). The other routes had the same latent
// defect, with less to gain.
//
// `strictObject` everywhere: an unknown key is REFUSED by name, not silently stripped. Stripping
// would have closed the hole, but the agent would have believed its request was heard as is. A 400
// naming the key tells it what it may not decide, in its tool result, where it can correct.
//
// Schemas describe SHAPE and stop there. What needs the database or session context (criteria of a
// proposed task, a wait target, a form spec) stays in the service that always judged it: their
// messages name the fault better than a type.
import { z } from "zod";
import { INBOX_KINDS } from "../inbox/inbox-enums.js";
import type { FsOp } from "../projects/fs-acl.js";
import { TASK_STATUSES } from "../tasks/lifecycle.js";
import { COMPLEXITIES } from "../tasks/task-scales.js";

/** `fs-acl.ts` only exports the TYPE: the list lived hard-coded in the route, it lives here, and
 *  `satisfies` refuses an operation that is no longer an `FsOp`. */
const FS_OPS = ["list", "read", "write", "mkdir", "delete"] as const satisfies readonly FsOp[];

/** POST /events. `payload` stays opaque: the runtime trace, each type reads it its own way. `seq` is
 *  the number the runtime assigned itself (v36); when absent, the route assigns one. */
export const eventBody = z.strictObject({
  type: z.string().min(1),
  payload: z.unknown().optional(),
  seq: z.number().int().positive().optional(),
});

/** POST /relaunch: the container hit its turn budget WHILE MOVING and asks to restart
 *  (`sessions/turn-relaunch.ts`). NOT an agent tool: the model cannot call this route, only the
 *  runner's guardrail posts it. The numbers are the container's measurements. */
export const relaunchBody = z.strictObject({
  used: z.number().int().positive(),
  pauseAt: z.number().int().positive(),
  cap: z.number().int().positive(),
  notice: z.string().min(1),
  measure: z.strictObject({
    idleTurns: z.number().int().nonnegative(),
    sinceTurn: z.number().int().nonnegative(),
    commits: z.number().int().nonnegative(),
    writes: z.number().int().nonnegative(),
    lastCommitTurn: z.number().int().nonnegative().nullable(),
    writable: z.boolean(),
  }),
});

/** POST /fs. `content` OR `contentBase64`; `fsExec` decides between them. */
export const fsBody = z.strictObject({
  op: z.enum(FS_OPS),
  path: z.string(),
  content: z.string().optional(),
  contentBase64: z.string().optional(),
});

/** POST /inbox: the fields the runtime's `inbox_ask` / `inbox_send` tool sends, and ONLY those.
 *  `reason`, `wakeAt`, `waitForTaskId` belong to the control plane (operator-pause, quota-pause,
 *  wait-for-task): their absence here is the fix. `form` stays `unknown`; `validateFormSpec` judges
 *  it in the route. */
export const inboxBody = z.strictObject({
  kind: z.enum(INBOX_KINDS),
  // No transforming `.trim()`: the body is stored as sent, only emptiness is refused.
  body: z.string().refine((s) => s.trim() !== "", "body required"),
  choices: z.array(z.strictObject({ id: z.string(), label: z.string() })).optional(),
  form: z.unknown().optional(),
  informational: z.boolean().optional(),
  evidence: z.string().optional(),
  impact: z.string().optional(),
  approval: z.boolean().optional(),
});

/** POST /propose-task. `criteria` stays `unknown`: `proposeTask` validates it naming each fault,
 *  which a shape schema would say less well. */
export const proposeTaskBody = z.strictObject({
  name: z.string(),
  brief: z.string(),
  complexity: z.enum(COMPLEXITIES).optional(),
  agentName: z.string().optional(),
  blocking: z.boolean().optional(),
  blockerIds: z.array(z.string()).optional(),
  criteria: z.unknown().optional(),
});

/** POST /wait-for-task: the target and the note for the human; guardrails are in the service. */
export const waitForTaskBody = z.strictObject({
  taskId: z.string(),
  note: z.string().optional(),
});

/** POST /request-repo: a project repository NAME and the reason for the human; whether it exists,
 *  is already granted, and the session state are judged in the service. */
export const requestRepoBody = z.strictObject({
  repo: z.string(),
  why: z.string(),
});

/** POST /steer: the requested hold window; the route caps it at `STEER_HOLD_MS`. */
export const steerBody = z.strictObject({
  waitMs: z.number().nonnegative().optional(),
});

/** PATCH /task: a status outside the list no longer reaches the database (before, `status` was
 *  written into the column as is, whatever the string). */
export const taskPatchBody = z.strictObject({
  status: z.enum(TASK_STATUSES).optional(),
  note: z.string().optional(),
});
