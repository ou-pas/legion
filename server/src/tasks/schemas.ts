// What the screen may send to the tasks domain: one schema per mutating body (06/09).
//
// Same move as `sessions/internal-schemas.ts`, for the other boundary: there the client is an agent,
// here it is the screen, which we write ourselves. That does not make checking decorative: the gap
// was real and hit ENUM columns. `complexity` and `priority` went as is into the `INSERT`; SQLite
// does not know Drizzle enums, it stored "huge", and `task-scales.ts`'s type became wrong everywhere
// downstream (model routing and queue order read these columns). `type` was already refused by
// hand: the guard covered one column in three.
//
// `strictObject` everywhere, as on `/internal`: an unknown key is refused by name. A silently
// ignored field is what lets a screen believe it set something.
//
// Schemas describe the shape and stop there. Blocker links (`blockers.ts`) and an attachment's spec
// (`attachments.ts`) stay judged by the service that owns them: their messages name the fault
// better than a type would.
import { z } from "zod";
import { TASK_STATUS, TASK_STATUSES } from "./lifecycle.js";
import { COMPLEXITIES, PRIORITIES } from "./task-scales.js";
import { BRANCH_TYPES } from "./task-branch.js";

/** POST /api/tasks/classify: the operator's pins are constraints. `null` means "no pin" and differs
 *  from absence: `task-classify.ts` reads both the same, but the screen sends `null` when it clears
 *  a field. */
export const classifyBody = z.strictObject({
  projectId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  forced: z
    .strictObject({
      agentId: z.string().nullish(),
      templateId: z.string().nullish(),
      complexity: z.enum(COMPLEXITIES).nullish(),
      gate: z.boolean().nullish(),
    })
    .optional(),
});

/** POST /api/tasks: `status` only admits the two birth statuses; a task is not born doing, in
 *  review or done. */
export const createTaskBody = z.strictObject({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  agentId: z.string().min(1),
  projectId: z.string().min(1),
  modelOverride: z.string().optional(),
  approvalGate: z.boolean().optional(),
  scheduledAt: z.number().optional(),
  readOnly: z.boolean().optional(),
  complexity: z.enum(COMPLEXITIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum([TASK_STATUS.todo, TASK_STATUS.later]).optional(),
  type: z.enum(BRANCH_TYPES).optional(),
  externalRef: z
    .strictObject({
      provider: z.string().min(1),
      issueId: z.string().min(1),
      identifier: z.string(),
      url: z.string(),
      branch: z.string().optional(),
    })
    .optional(),
  blockerIds: z.array(z.string()).optional(),
});
export type CreateTaskBody = z.infer<typeof createTaskBody>;

/** The brief is what the agent was asked: long, but not unlimited. Beyond this, it is an attached
 *  file, not an instruction. */
export const DESCRIPTION_MAX = 20_000;

/** PATCH /api/tasks/:id: three families in one body, status/archiving, the brief, and settings
 *  (blockers included). Each goes to its own service; the schema only states the shape. */
export const patchTaskBody = z.strictObject({
  name: z.string().optional(),
  agentId: z.string().optional(),
  approvalGate: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  complexity: z.enum(COMPLEXITIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  // v2c (nav): the forced model, a structural setting like complexity/priority, so it joins the same
  // settings and the same editability guard (task-edit.ts). `null` removes the override and hands
  // back to complexity routing; absent = untouched.
  modelOverride: z.string().nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  archived: z.boolean().optional(),
  description: z
    .string()
    .max(DESCRIPTION_MAX, `brief too long (maximum ${DESCRIPTION_MAX} characters)`)
    .optional(),
  /** v66: the machine designated for the next sessions. `null` is a value, not an absence: it clears
   *  the choice and hands back to the control plane. Absent = untouched. */
  chosenRunnerId: z.string().min(1).nullable().optional(),
  addBlockerIds: z.array(z.string()).optional(),
  removeBlockerIds: z.array(z.string()).optional(),
});
export type PatchTaskBody = z.infer<typeof patchTaskBody>;

/** POST /api/tasks/:id/move: a drop always carries both, column and rank. `status` stays a free
 *  string here; `applyTaskMove` judges it against real statuses and names the unknown column. */
export const moveTaskBody = z.strictObject({
  status: z.string(),
  index: z.number(),
});

/** POST /api/tasks/archive-done: the gesture targets a whole project, nothing else. */
export const archiveDoneBody = z.strictObject({ projectId: z.string().min(1) });

/** POST /api/tasks/:id/attachments: both fields stay optional; `saveAttachment` refuses (422) a
 *  file without name, empty or too big, naming the cap. A shape 400 would only say "missing". */
export const attachmentBody = z.strictObject({
  name: z.string().optional(),
  contentBase64: z.string().optional(),
});

/** POST /api/tasks/:id/message: length is bounded by `sendTaskMessage` (`TASK_MESSAGE_MAX`), which
 *  also owns refusing an empty message. */
export const taskMessageBody = z.strictObject({ text: z.string() });
