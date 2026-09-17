// Editing a goal. It used to be immutable from creation: name, request, rails. On a `draft` goal,
// which has launched nothing, the only way out was killing it and creating another, leaving one
// more dead row in the list. On a running goal, nearing the budget cap forced the same thing.
//
// Two field families, two status rules, neither derived from the other:
//
//  · The brief (`name`, `request`, `allowedAgentIds`), editable in `draft` only. After approval the
//    request has already gone into the loop: `decide()` copies it into every orchestrator prompt,
//    and the agent pool already chose past iterations' specialists. Rewriting it would lie on
//    screen about what the loop received; same principle as a task's brief (`task-edit.ts`) and an
//    agent's role (`capabilities/agent/role-edit.ts`), both refusing with 409.
//
//  · The rails (`budgetUsd`, `maxHours`, `maxNoProgress`), editable in `draft`, `active` and
//    `paused`. A rail is not an instruction to an agent but a bound `checkRails()` re-reads on
//    every loop round, so moving it applies immediately without rewriting the past. Raising a
//    budget you are nearing is the expected gesture, and exactly the one that forced a re-create.
//
// On a finished goal (`completed`, `stopped-*`, `failed`, `cancelled`) nothing is editable: raising
// a stopped goal's budget does not restart it (`resumeGoal` only accepts `paused`), it would only
// mask the reason it stopped in the log.
import { agentIdsOf, goalRow, saveGoalEdit } from "./goal-edit-store.js";
import type { GoalRow } from "./goal-edit-store.js";
import { type DodItem, type PlanStep, generateDod, logGoal, serializeGoal } from "./goals.js";
import { GOAL_STATUS } from "./goal-status.js";

type GoalStatus = GoalRow["status"];

/** What a request may ask to change. `null` on a rail = "no cap", a value, not an absence;
 *  `undefined` (field absent) means "leave it alone". */
export interface GoalPatch {
  name?: string;
  request?: string;
  budgetUsd?: number | null;
  /** Converted to `maxDurationMs` as at creation: the API speaks hours, the database ms. */
  maxHours?: number | null;
  maxNoProgress?: number;
  allowedAgentIds?: string[];
}

const BRIEF_FIELDS = ["name", "request", "allowedAgentIds"] as const;
const RAIL_FIELDS = ["budgetUsd", "maxHours", "maxNoProgress"] as const;
const EDITABLE_FIELDS = [...BRIEF_FIELDS, ...RAIL_FIELDS] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

/** API field → column. Only one pair is not the identity, which is why this table exists: the API
 *  speaks `maxHours`, the database stores `maxDurationMs`. */
const COLUMN_OF: Record<EditableField, keyof GoalRow> = {
  name: "name",
  request: "request",
  allowedAgentIds: "allowedAgentIds",
  budgetUsd: "budgetUsd",
  maxHours: "maxDurationMs",
  maxNoProgress: "maxNoProgress",
};

/** Statuses where a rail still moves: those of a goal that has not finished its run. */
const RAIL_EDITABLE: readonly GoalStatus[] = [
  GOAL_STATUS.draft,
  GOAL_STATUS.active,
  GOAL_STATUS.paused,
];

/** DoD generation, injectable, same pattern as `ConciergeDeps` (concierge.ts): the only way to
 *  prove tolerance to a generation failure without calling the real SDK. Only tests pass it. */
export type GoalEditDeps = {
  regenerate: (goalId: string) => Promise<{ dod: DodItem[]; plan: PlanStep[] }>;
};
const DEPS: GoalEditDeps = { regenerate: generateDod };

export type GoalEditRefusal = { ok: false; status: 400 | 404 | 409; error: string };
export type GoalEditDone = {
  ok: true;
  goal: ReturnType<typeof serializeGoal>;
  /** Fields whose value actually changed: an identical rewrite lists none. */
  changed: EditableField[];
  /** Present when the request changed: the freshly regenerated DoD and plan. */
  dod?: DodItem[];
  plan?: PlanStep[];
  /** Regeneration failed: the edit is kept anyway, the DoD is empty, to be rerun. */
  warning?: string;
};
export type GoalEditResult = GoalEditDone | GoalEditRefusal;

const BRIEF_FROZEN = (status: GoalStatus, fields: EditableField[]): string =>
  `this goal is “${status}”: ${fields.join(", ")} cannot be changed after approval — the request ` +
  `has already gone into the loop, and rewriting it would lie about what the orchestrator ` +
  `received. Its rails (budget, duration, no-progress threshold) stay editable.`;

const RAILS_FROZEN = (status: GoalStatus): string =>
  `this goal is over (“${status}”): its rails do not move any more. Raising the budget of a ` +
  `stopped goal does not restart it — only a “paused” goal resumes.`;

/** Numeric rail validation, naming the field and what is expected: a bare 400 would force reading
 *  the server code to know what to fix. */
function invalidNumber(
  field: string,
  value: unknown,
  opts: { integer?: boolean; nullable: boolean },
): string | null {
  if (value === null) return opts.nullable ? null : `${field} cannot be empty`;
  if (typeof value !== "number" || !Number.isFinite(value)) return `${field} must be a number`;
  if (value <= 0) return `${field} must be strictly positive (received: ${value})`;
  if (opts.integer && !Number.isInteger(value))
    return `${field} must be an integer (received: ${value})`;
  return null;
}

/** Cited agents must exist in the goal's project. Without this guard a foreign id (copied from
 *  another project) shrank the pool to zero, and the loop stopped later on "no allowed agents", a
 *  failure far from its cause. */
function unknownAgent(goal: GoalRow, ids: string[]): string | null {
  if (ids.length === 0) return null;
  const known = new Set(agentIdsOf(goal.projectId));
  const stranger = ids.find((id) => !known.has(id));
  return stranger ? `agent “${stranger}” unknown in this project` : null;
}

/** Translates the patch into columns, or returns the first refusal. Two halves: the brief (what the
 *  goal asks) and the rails (what stops it). They do not freeze at the same moment nor validate the
 *  same way. */
function toColumns(goal: GoalRow, patch: GoalPatch): Partial<GoalRow> | GoalEditRefusal {
  const brief = briefColumns(goal, patch);
  if ("ok" in brief) return brief;
  const rails = railColumns(patch);
  if ("ok" in rails) return rails;
  return { ...brief, ...rails };
}

const bad = (error: string): GoalEditRefusal => ({ ok: false, status: 400, error });

/** Name, request, allowed agents: what the human wrote, frozen at approval. */
function briefColumns(goal: GoalRow, patch: GoalPatch): Partial<GoalRow> | GoalEditRefusal {
  const cols: Partial<GoalRow> = {};
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string" || !patch.name.trim())
      return bad("the name cannot be empty");
    cols.name = patch.name.trim();
  }
  if (patch.request !== undefined) {
    if (typeof patch.request !== "string" || !patch.request.trim())
      return bad("the request cannot be empty");
    cols.request = patch.request.trim();
  }
  if (patch.allowedAgentIds !== undefined) {
    if (
      !Array.isArray(patch.allowedAgentIds) ||
      patch.allowedAgentIds.some((id) => typeof id !== "string")
    )
      return bad("allowedAgentIds must be a list of agent ids");
    const stranger = unknownAgent(goal, patch.allowedAgentIds);
    if (stranger) return bad(stranger);
    cols.allowedAgentIds = JSON.stringify(patch.allowedAgentIds);
  }
  return cols;
}

/** Budget, duration, no-progress threshold: what stops the loop, movable until the goal is over. */
function railColumns(patch: GoalPatch): Partial<GoalRow> | GoalEditRefusal {
  const cols: Partial<GoalRow> = {};
  if (patch.budgetUsd !== undefined) {
    const err = invalidNumber("budgetUsd", patch.budgetUsd, { nullable: true });
    if (err) return bad(err);
    cols.budgetUsd = patch.budgetUsd;
  }
  if (patch.maxHours !== undefined) {
    const err = invalidNumber("maxHours", patch.maxHours, { nullable: true });
    if (err) return bad(err);
    cols.maxDurationMs = patch.maxHours === null ? null : Math.round(patch.maxHours * 3_600_000);
  }
  if (patch.maxNoProgress !== undefined) {
    const err = invalidNumber("maxNoProgress", patch.maxNoProgress, {
      integer: true,
      nullable: false,
    });
    if (err) return bad(err);
    cols.maxNoProgress = patch.maxNoProgress;
  }
  return cols;
}

/** The requested fields that actually exist: a body that only mentions `spentUsd` edits nothing and
 *  must say so, rather than return a success that did nothing. */
function askedFields(patch: GoalPatch): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => patch[f] !== undefined);
}

/** Regeneration lives in the PATCH, and that is the decision.
 *
 *  Changing `request` makes the DoD and plan obsolete: they describe how to finish another request.
 *  The alternative, an explicit route to click afterwards, was rejected because it opens a window
 *  where the screen shows a DoD that no longer matches the request right above it, and nothing
 *  forces the operator to close it before approving. A stale DoD approved by mistake launches the
 *  loop on the wrong criteria, the most expensive error this route could enable. Creation already
 *  does exactly this (`POST /api/goals` awaits `generateDod`).
 *
 *  DoD and plan are emptied in the same write as the request, before the call: if generation fails,
 *  the screen shows an empty DoD (to redo) rather than one that lies. The edit is already written;
 *  a PATCH is not lost because the model did not answer (same tolerance as creation: 201 +
 *  `warning`). `POST /api/goals/:id/regenerate` exists for that case only. */
export async function editGoal(
  goalId: string,
  patch: GoalPatch,
  deps: GoalEditDeps = DEPS,
): Promise<GoalEditResult> {
  const goal = goalRow(goalId);
  if (!goal) return { ok: false, status: 404, error: "goal not found" };

  const asked = askedFields(patch ?? {});
  if (asked.length === 0)
    return {
      ok: false,
      status: 400,
      error: `no editable field in the request (expected: ${EDITABLE_FIELDS.join(", ")})`,
    };

  const frozen = frozenRefusal(goal, asked);
  if (frozen) return frozen;
  const rails = fieldsIn(asked, RAIL_FIELDS);

  const cols = toColumns(goal, patch);
  if ("ok" in cols) return cols;

  // What actually moved: an identical rewrite logs and regenerates nothing (otherwise reopening a
  // form and submitting it unchanged would erase the DoD).
  const changed = asked.filter((f) => cols[COLUMN_OF[f]] !== goal[COLUMN_OF[f]]);
  if (changed.length === 0) return { ok: true, goal: serializeGoal(goal), changed: [] };

  const requestChanged = changed.includes("request");
  const write: Partial<GoalRow> = requestChanged ? { ...cols, dod: "[]", plan: "[]" } : cols;
  saveGoalEdit(goalId, write);
  logGoal(goalId, "edit", {
    changed,
    ...(rails.length > 0
      ? {
          budgetUsd: write.budgetUsd ?? goal.budgetUsd,
          maxDurationMs: write.maxDurationMs ?? goal.maxDurationMs,
          maxNoProgress: write.maxNoProgress ?? goal.maxNoProgress,
        }
      : {}),
    ...(requestChanged ? { dodInvalidated: true } : {}),
  });

  if (!requestChanged) return { ok: true, goal: serializeGoal(goalRow(goalId)!), changed };
  return withRegeneratedDod(goalId, changed, deps);
}

const fieldsIn = (asked: EditableField[], family: readonly string[]): EditableField[] =>
  asked.filter((f) => family.includes(f));

/** What is still editable at this status, or the refusal saying so. The brief freezes at approval;
 *  rails stop moving on a finished goal. `null` when nothing objects. */
function frozenRefusal(goal: GoalRow, asked: EditableField[]): GoalEditRefusal | null {
  const brief = fieldsIn(asked, BRIEF_FIELDS);
  if (brief.length > 0 && goal.status !== GOAL_STATUS.draft)
    return { ok: false, status: 409, error: BRIEF_FROZEN(goal.status, brief) };
  if (fieldsIn(asked, RAIL_FIELDS).length > 0 && !RAIL_EDITABLE.includes(goal.status))
    return { ok: false, status: 409, error: RAILS_FROZEN(goal.status) };
  return null;
}

/** An edit that touched the request also returns the redone DoD and plan. A failed generation
 *  undoes nothing: the edit is written, the DoD is empty (visibly to redo) and the warning says
 *  why. */
async function withRegeneratedDod(
  goalId: string,
  changed: EditableField[],
  deps: GoalEditDeps,
): Promise<GoalEditDone> {
  try {
    const { dod, plan } = await deps.regenerate(goalId);
    return { ok: true, goal: serializeGoal(goalRow(goalId)!), changed, dod, plan };
  } catch (err) {
    const warning = `request saved, but the DoD could not be regenerated: ${(err as Error).message}`;
    logGoal(goalId, "rail", { dodRegenerationFailed: (err as Error).message.slice(0, 200) });
    return { ok: true, goal: serializeGoal(goalRow(goalId)!), changed, dod: [], plan: [], warning };
  }
}

export type GoalRegenerateResult =
  | { ok: true; dod: DodItem[]; plan: PlanStep[] }
  | { ok: false; status: 404 | 409 | 502; error: string };

/** Redo a `draft` goal's DoD and plan: recover from a generation that failed during a PATCH, or ask
 *  again for a DoD judged bad without touching the request.
 *
 *  `draft` only: after approval the DoD is the contract the human validated and the loop ticks its
 *  items as it goes (`decision.dodDone`). Regenerating would erase those ticks and replace approved
 *  criteria with unseen ones. */
export async function regenerateGoalDod(
  goalId: string,
  deps: GoalEditDeps = DEPS,
): Promise<GoalRegenerateResult> {
  const goal = goalRow(goalId);
  if (!goal) return { ok: false, status: 404, error: "goal not found" };
  if (goal.status !== GOAL_STATUS.draft)
    return {
      ok: false,
      status: 409,
      error:
        `this goal is “${goal.status}”: its DoD is the contract the human approved and the loop ` +
        `ticks its criteria there — it is not regenerated any more.`,
    };
  try {
    const { dod, plan } = await deps.regenerate(goalId);
    return { ok: true, dod, plan };
  } catch (err) {
    // Nothing was written (`generateDod` only writes on success): the previous state holds and the
    // gesture can be repeated. An upstream failure, not a faulty request.
    return {
      ok: false,
      status: 502,
      error: `generating the DoD is impossible: ${(err as Error).message}`,
    };
  }
}
