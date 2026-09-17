// Editing the settings of a task that has not started (title, agent, approval gate, complexity,
// priority): everything `TaskComposer` sets at creation that nothing allowed amending before this
// module (plan "Edit an uncommitted task", §2.1).
import { taskLiveSessions } from "../projects/purge.js";
import type { schema } from "../shared/db.js";
import { EDITABLE_STATUSES, isTaskEditable } from "./lifecycle.js";
import { COMPLEXITIES, PRIORITIES } from "./task-scales.js";
import { findAgentRow, findTaskRow, isDemoProject, updateTaskFields } from "./task-edit-store.js";

type TaskRow = typeof schema.tasks.$inferSelect;

export type TaskEdit = {
  name?: string;
  agentId?: string;
  approvalGate?: boolean;
  /** v53: read-only, repositories cloned with `access: "read"`, nothing pushes, no PR. */
  readOnly?: boolean;
  complexity?: "low" | "med" | "high";
  priority?: "low" | "med" | "high";
  /** v2c (nav): forces a model for this task. `null` removes the override: complexity routing takes
   *  over again. */
  modelOverride?: string | null;
};

export type EditResult =
  | { ok: true; task: TaskRow }
  | { ok: false; status: 400 | 404 | 409; error: string; live?: { id: string; status: string }[] };

type FieldError = { ok: false; status: 400; error: string };
type ResolvedFields = {
  name?: string;
  assigneeAgentId?: string;
  approvalGate?: boolean;
  readOnly?: boolean;
  complexity?: TaskEdit["complexity"];
  priority?: TaskEdit["priority"];
  modelOverride?: string | null;
};

const NAME_MAX = 200;

function resolveName(patch: TaskEdit): { name?: string } | FieldError {
  if (patch.name === undefined) return {};
  const trimmed = patch.name.trim();
  if (!trimmed) return { ok: false, status: 400, error: "empty title" };
  if (trimmed.length > NAME_MAX)
    return {
      ok: false,
      status: 400,
      error: `title too long (${trimmed.length} characters, maximum ${NAME_MAX})`,
    };
  return { name: trimmed };
}

/** Scalar fields, checked against the enum or expected type: no task to load for that, only the
 *  body's shape. */
function resolveScalars(patch: TaskEdit): FieldError | null {
  if (patch.complexity !== undefined && !COMPLEXITIES.includes(patch.complexity))
    return { ok: false, status: 400, error: `invalid complexity: “${patch.complexity}”` };
  if (patch.priority !== undefined && !PRIORITIES.includes(patch.priority))
    return { ok: false, status: 400, error: `invalid priority: “${patch.priority}”` };
  if (patch.approvalGate !== undefined && typeof patch.approvalGate !== "boolean")
    return { ok: false, status: 400, error: "approvalGate must be a boolean" };
  if (patch.readOnly !== undefined && typeof patch.readOnly !== "boolean")
    return { ok: false, status: 400, error: "readOnly must be a boolean" };
  return null;
}

/** The target agent, from the same project as the task (R2: the FK only covers `agents.id`, with no
 *  project constraint, and an agent from another project would bring its repositories, secrets and
 *  grants at launch, `runner/manager.ts:loadContext`). */
function resolveAgentId(patch: TaskEdit, task: TaskRow): { assigneeAgentId?: string } | FieldError {
  if (patch.agentId === undefined) return {};
  const agent = findAgentRow(patch.agentId);
  if (!agent) return { ok: false, status: 400, error: `agent not found: “${patch.agentId}”` };
  if (agent.projectId !== task.projectId)
    return {
      ok: false,
      status: 400,
      error: `agent of project “${agent.projectId}”, task of project “${task.projectId}”`,
    };
  return { assigneeAgentId: agent.id };
}

/** The named refusal when the task is no longer editable, or `null` if it still is. */
function editRefusal(
  task: TaskRow,
  demoProject: boolean,
  live: { id: string; status: string }[],
): EditResult | null {
  if (isTaskEditable(task, { hasLiveSession: live.length > 0, demoProject })) return null;
  if (demoProject)
    return { ok: false, status: 409, error: "demo project: read only, nothing gets edited here" };
  if (live.length > 0)
    return {
      ok: false,
      status: 409,
      error: `session ${live[0]!.status} in flight: its settings have already gone out, they do not get rewritten afterwards`,
      live,
    };
  return {
    ok: false,
    status: 409,
    error: `a “${task.status}” task has started: its settings are frozen`,
  };
}

/** Applies a settings edit, or refuses naming the block precisely, never a silent success. The
 *  editability guard is carried twice, on purpose:
 *   1. here, on read, to return a message naming the reason (404, agent outside the project, live
 *      session, frozen status): a mute refusal cannot be repaired;
 *   2. in the `UPDATE`'s `WHERE`, to close the race where the task starts during this function
 *      (between the read below and the write): `changes === 0` then falls back to a generic 409
 *      rather than writing on a task that just went into a session. */
export function applyTaskEdit(taskId: string, patch: TaskEdit): EditResult {
  if (Object.keys(patch).length === 0) return { ok: false, status: 400, error: "no field to edit" };

  const task = findTaskRow(taskId);
  if (!task) return { ok: false, status: 404, error: "task not found" };

  const nameField = resolveName(patch);
  if ("ok" in nameField) return nameField;
  const scalarError = resolveScalars(patch);
  if (scalarError) return scalarError;
  const agentField = resolveAgentId(patch, task);
  if ("ok" in agentField) return agentField;

  const demoProject = isDemoProject(task.projectId);
  const live = demoProject ? [] : taskLiveSessions(taskId);
  const refusal = editRefusal(task, demoProject, live);
  if (refusal) return refusal;

  const fields: ResolvedFields = {
    ...nameField,
    ...agentField,
    ...(patch.approvalGate !== undefined ? { approvalGate: patch.approvalGate } : {}),
    ...(patch.readOnly !== undefined ? { readOnly: patch.readOnly } : {}),
    ...(patch.complexity !== undefined ? { complexity: patch.complexity } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.modelOverride !== undefined ? { modelOverride: patch.modelOverride } : {}),
  };

  // The guard above just read `task.status`; it is restated in the `WHERE` (see `updateTaskFields`)
  // so the update fails (changes === 0) if the status moved in between: no window where a
  // concurrent launch and this edit both write "successfully".
  const changes = updateTaskFields(taskId, fields, EDITABLE_STATUSES);
  if (changes === 0)
    return {
      ok: false,
      status: 409,
      error: "the task started in the meantime: its settings are frozen",
    };

  return { ok: true, task: findTaskRow(taskId)! };
}
