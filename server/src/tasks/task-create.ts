// Creating a task: the insert and its blocker links, in one transaction (06/09).
//
// Moved out of the routes on the same pattern as `task-edit.ts`: an importable module, hence
// testable, where a route only is through a mounted Hono app. The body's shape is judged upstream
// (`schemas.ts`); this file only sees well-typed values and keeps the refusal that needs the
// database: the validity of blocker links.
import { nanoid } from "nanoid";
import type { schema } from "../shared/db.js";
import { validateBlockerLinks } from "./blockers.js";
import { TASK_STATUS } from "./lifecycle.js";
import { COMPLEXITY, PRIORITY } from "./task-scales.js";
import { BRANCH_TYPE } from "./task-branch.js";
import { insertTask as insertTaskRow } from "./task-create-store.js";
import type { CreateTaskBody } from "./schemas.js";

type TaskRow = typeof schema.tasks.$inferSelect;

export type CreateTaskResult =
  | { ok: true; task: TaskRow }
  | { ok: false; status: 400 | 500; error: string };

/** Creates the task and sets its blockers. Returns the re-read row, not the inserted object: that
 *  one lacks the columns left to database defaults (`queued`, `archived`, `prUrls`…), so the
 *  response lied by omission, a caller got `queued: undefined` for a task that was `false`. */
export function createTask(body: CreateTaskBody): CreateTaskResult {
  // The id is drawn before validating links: `validateBlockerLinks` needs it to refuse
  // self-blocking and cycles, the same rule as when editing.
  const id = nanoid(10);
  const blockerIds = [...new Set(body.blockerIds ?? [])];
  if (blockerIds.length > 0) {
    // Self-blocking, existence, project boundary, blocker already `done`, cycle (impossible here,
    // the task does not exist yet; kept so the rule is the same as when editing).
    const err = validateBlockerLinks(id, blockerIds, body.projectId);
    if (err) return { ok: false, status: 400, error: err.error };
  }

  const now = new Date();
  const task = {
    id,
    projectId: body.projectId,
    name: body.name,
    description: body.description ?? "",
    status: body.status ?? TASK_STATUS.todo,
    // Initial rank = creation instant (v21): a new task joins the bottom of its column, the same
    // convention as the migration backfill; see task-move.ts.
    boardOrder: now.getTime(),
    assigneeAgentId: body.agentId,
    modelOverride: body.modelOverride ?? null,
    approvalGate: body.approvalGate ?? false,
    readOnly: body.readOnly ?? false,
    complexity: body.complexity ?? COMPLEXITY.med,
    priority: body.priority ?? PRIORITY.med,
    type: body.type ?? BRANCH_TYPE.chore,
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
    externalRef: body.externalRef ? JSON.stringify(body.externalRef) : null,
    createdAt: now,
    updatedAt: now,
  };

  // Insert and links in the same transaction: a link added afterwards would open a window where
  // `pumpQueue` (which filters on `blockedTaskIds`) could take the task before the link exists.
  // Same reason `instantiateTemplate` (chains/templates.ts) links the previous step in its own
  // transaction.
  const created = insertTaskRow(task, blockerIds);

  // The re-read follows the `INSERT` in the same transaction, so the row is there. The explicit
  // check replaces a `!`: a forced non-null promises the same and leaves no trace the day the promise
  // breaks.
  if (!created) return { ok: false, status: 500, error: "task inserted then not found" };
  return { ok: true, task: created };
}
