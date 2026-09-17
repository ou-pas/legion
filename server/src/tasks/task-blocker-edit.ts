// Editing blockers between two sessions: `PATCH /api/tasks/:id` (`addBlockerIds` /
// `removeBlockerIds`), next to `task-edit.ts` and on the same pattern.
//
// Add and remove are separate, never a full list replacing the existing one. That contract settles
// the question: a client PATCHing its blockers without knowing a chain (or `propose_task`) added one
// in the meantime would silently erase that link with a full list. `add`/`remove` can only add to
// what they ignore, never overwrite it; the only remaining risk is an explicit removal of an id the
// caller named, which is the intended gesture.
import { taskLiveSessions } from "../projects/purge.js";
import type { schema } from "../shared/db.js";
import { ACTIVE_STATUSES } from "../sessions/session-terminal.js";
import { areBlockersEditable } from "./lifecycle.js";
import { validateBlockerLinks } from "./blockers.js";
import { applyBlockerChanges, findTaskRow, isDemoProject } from "./task-blocker-edit-store.js";

type TaskRow = typeof schema.tasks.$inferSelect;

export type BlockerEdit = { add?: string[]; remove?: string[] };

export type BlockerEditResult =
  | { ok: true; task: TaskRow }
  | { ok: false; status: 400 | 404 | 409; error: string; live?: { id: string; status: string }[] };

type NormalizedPatch = { add: string[]; remove: string[] };
type PatchError = { ok: false; status: 400; error: string };

/** Validates and normalises `add`/`remove`: types, uniqueness, non-emptiness, and no id on both
 *  sides at once. Touches neither the database nor the task: a pure question of body shape. */
function normalizeBlockerPatch(patch: BlockerEdit): NormalizedPatch | PatchError {
  const rawAdd = patch.add ?? [];
  const rawRemove = patch.remove ?? [];
  if (!Array.isArray(rawAdd) || !rawAdd.every((id) => typeof id === "string"))
    return { ok: false, status: 400, error: "add must be an array of ids" };
  if (!Array.isArray(rawRemove) || !rawRemove.every((id) => typeof id === "string"))
    return { ok: false, status: 400, error: "remove must be an array of ids" };

  const add = [...new Set(rawAdd)];
  const remove = [...new Set(rawRemove)];
  if (add.length === 0 && remove.length === 0)
    return { ok: false, status: 400, error: "add or remove required, with at least one id" };

  const overlap = add.filter((id) => remove.includes(id));
  if (overlap.length > 0)
    return {
      ok: false,
      status: 400,
      error: `id(s) both added and removed: ${overlap.join(", ")}`,
    };

  return { add, remove };
}

/** The named refusal when blockers are no longer editable, or `null` if they still are.
 *
 *  Status no longer enters the decision since 10/09 (`areBlockersEditable`, lifecycle.ts): a blocker
 *  decides the next launch, so it stays ours while no session runs. That makes a link wrongly set by
 *  `propose_task(blocking: true)` on a task already in `review` repairable. */
function blockerEditRefusal(
  demoProject: boolean,
  live: { id: string; status: string }[],
): BlockerEditResult | null {
  if (areBlockersEditable({ hasLiveSession: live.length > 0, demoProject })) return null;
  if (demoProject)
    return { ok: false, status: 409, error: "demo project: read only, nothing gets edited here" };
  return {
    ok: false,
    status: 409,
    error: `session ${live[0]!.status} in flight: its blockers have already gone out, they do not get rewritten afterwards`,
    live,
  };
}

/** Applies a blocker add/remove, or refuses naming the block precisely, same discipline as
 *  `applyTaskEdit`: the editability guard is carried twice, once on read for a named message, once
 *  inside the write transaction to close the race where a session starts during this call. */
export function applyBlockerEdit(taskId: string, patch: BlockerEdit): BlockerEditResult {
  const normalized = normalizeBlockerPatch(patch);
  if ("ok" in normalized) return normalized;
  const { add, remove } = normalized;

  const task = findTaskRow(taskId);
  if (!task) return { ok: false, status: 404, error: "task not found" };

  const demoProject = isDemoProject(task.projectId);
  const live = demoProject ? [] : taskLiveSessions(taskId);
  const refusal = blockerEditRefusal(demoProject, live);
  if (refusal) return refusal;

  if (add.length > 0) {
    const err = validateBlockerLinks(taskId, add, task.projectId);
    if (err) return { ok: false, status: err.status, error: err.error };
  }

  const applied = applyBlockerChanges(taskId, add, remove, ACTIVE_STATUSES);
  if (!applied)
    return {
      ok: false,
      status: 409,
      error: "the task started in the meantime: its blockers are frozen",
    };

  return { ok: true, task: findTaskRow(taskId)! };
}
