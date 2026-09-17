// Approving a batch of slices: the gesture that moves a breakdown from the artifact to the board
// ("decoupe" spec, behaviours 4, 5, 6 and the link half of 10).
//
// The Breakdown step drops `slices.json` and goes to review. This module reads that artifact at
// approval time (a later drop replaces an earlier one), validates it naming every fault, and if
// it holds creates the tasks in one transaction.
//
// The transaction order is the behaviour: slices are born with their links, then the Wiki step is
// linked to each, and only then does Breakdown become done. A link added after the release would
// block nobody: Breakdown's done consumes the Breakdown → Wiki link, and if the slices were not
// already holding Wiki at that instant, Wiki would start.
//
// Not here: the faults of one slice (`tasks/criteria.ts`, slice 04), because they also apply to a
// leftover dropped outside a batch; and writing `task_blockers` (`tasks/blockers.ts`), which stays
// the table's only writer.
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { schema } from "../shared/db.js";
import {
  agentsOfProject,
  chainTemplateById,
  inLotTransaction,
  insertSliceTask,
  projectChainBindings,
  projectPaths,
  taskById,
} from "./slices-store.js";
import { projectRoot } from "../projects/fs-acl.js";
import { artifactsPath } from "../tasks/artifacts/scope.js";
import { addBlocker, dependentsOf } from "../tasks/blockers.js";
import { readCriteria, validateSlice, type SliceDraft } from "../tasks/criteria.js";
import { onTaskDone, resolveStepAgent, settleDone, type TemplateStep } from "./templates.js";
import { recordLotRefusal } from "./lot-refusal.js";
import { applyTaskTransition, TASK_MOVE, TASK_STATUS } from "../tasks/lifecycle.js";

type TaskRow = typeof schema.tasks.$inferSelect;

/** The drop name, the one the "slice" skill dictates to the agent and the Breakdown step declares
 *  in its artifact contract. */
export const LOT_ARTIFACT = "slices.json";

/** The role slices are assigned to. Same cascade as any chain step: the project mapping first, a
 *  catalogue agent of the same name as fallback. */
export const BUILD_ROLE = "build";

/** The task's template step, if it is marked "approves a batch"; `null` everywhere else. A slice
 *  created here does carry `templateId` but no `stepIndex`: it is not a chain step, it is born
 *  between two. */
export function lotStep(task: {
  templateId: string | null;
  stepIndex: number | null;
}): TemplateStep | null {
  if (!task.templateId || task.stepIndex === null) return null;
  const tpl = chainTemplateById(task.templateId);
  if (!tpl) return null;
  try {
    const step = (JSON.parse(tpl.steps) as TemplateStep[])[task.stepIndex];
    return step?.approvesLot ? step : null;
  } catch {
    return null; // broken template: an ordinary step, as before slice 05
  }
}

/** The refusal shared by the three paths that finish a task (operator PATCH, Kanban drop, the
 *  agent's `/internal`): only the approval gesture finishes a Breakdown step (behaviour 5). A guard
 *  in the shared function rather than a copy per caller: the three status updates are separate,
 *  the refusal is the same. `null` = nothing to refuse. */
export function lotApprovalOnly(task: {
  templateId: string | null;
  stepIndex: number | null;
}): string | null {
  return lotStep(task)
    ? "only approving the batch finishes this step: approve the slices from its page"
    : null;
}

export type LotRead = { ok: true; slices: SliceDraft[] } | { ok: false; fault: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The artifact as it is right now. The readable shape stops at the batch: an object, a `slices`
 *  array, objects inside. Anything deeper (missing field, wrong type in a slice) is a slice fault
 *  named by its rank, more useful to the agent than an "unreadable" that says nowhere to look. */
export function readLot(task: TaskRow): LotRead {
  const project = projectPaths(task.projectId);
  if (!project) return { ok: false, fault: `project not found: ${LOT_ARTIFACT} has no folder` };
  const file = path.join(
    projectRoot(project.slug, project.fsRoot),
    artifactsPath(task),
    LOT_ARTIFACT,
  );
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, fault: `artifact ${LOT_ARTIFACT} missing from the run artifacts folder` };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, fault: `artifact ${LOT_ARTIFACT} unreadable: this is not valid JSON` };
  }
  if (!isRecord(value) || !Array.isArray(value.slices) || !value.slices.every(isRecord))
    return {
      ok: false,
      fault: `artifact ${LOT_ARTIFACT} unreadable: the expected shape is { "slices": [ … ] }`,
    };
  // The artifact's names are not the internal type's: `successMeans` and `criteria` speak to the
  // agent, `outcome` and `items` to the code. The translation happens here, once.
  return {
    ok: true,
    slices: value.slices.map((s) => ({
      label: s.label,
      outcome: s.successMeans,
      validatedBy: s.validatedBy,
      items: s.criteria,
      blockedBy: s.blockedBy,
    })),
  };
}

/** The batch as rendered on screen. Coercion lives here, next to the read, not in the component:
 *  a faulty batch still renders (its faults say what is wrong), and making the screen re-check
 *  each field would write the tolerance rule twice. An absent or mistyped field becomes empty, and
 *  the fault naming it sits next to it. */
export type LotSliceView = {
  label: string;
  outcome: string;
  validatedBy: string;
  items: { text: string; mode: string; edge?: string }[];
  blockedBy: number[];
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function lotView(slices: readonly SliceDraft[]): LotSliceView[] {
  return slices.map((s) => ({
    label: str(s.label),
    outcome: str(s.outcome),
    validatedBy: str(s.validatedBy),
    items: (Array.isArray(s.items) ? s.items : []).map((raw) => {
      const c = isRecord(raw) ? raw : {};
      return {
        text: str(c.text),
        mode: str(c.mode),
        ...(typeof c.edge === "string" ? { edge: c.edge } : {}),
      };
    }),
    blockedBy: (Array.isArray(s.blockedBy) ? s.blockedBy : []).filter(
      (b): b is number => typeof b === "number",
    ),
  }));
}

/** The ranks (1-based) this slice declares as blockers that actually designate a slice of the
 *  batch. The rest is already a fault named by `validateSlice`. */
function declaredRanks(slice: SliceDraft, count: number): number[] {
  const raw = Array.isArray(slice.blockedBy) ? slice.blockedBy : [];
  const kept = raw.filter(
    (b): b is number => typeof b === "number" && Number.isInteger(b) && b >= 1 && b <= count,
  );
  return [...new Set(kept)];
}

/** Groups of ranks caught in a cycle, each once, ranks ascending and groups ordered by first rank.
 *
 *  ponytail: O(n³) transitive closure; a batch counts slices, not thousands of nodes. Switch to
 *  Tarjan when a batch gets big enough to measure. A group is a strongly connected component: two
 *  cycles sharing a slice are one group, which is what "named once" means. A slice blocking itself
 *  is a group on its own. */
function cycles(slices: SliceDraft[]): number[][] {
  const n = slices.length;
  const reach = slices.map((s) => new Set(declaredRanks(s, n).map((r) => r - 1)));
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++) if (reach[i]!.has(k)) for (const j of reach[k]!) reach[i]!.add(j);
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (seen.has(i) || !reach[i]!.has(i)) continue;
    const group = [i];
    seen.add(i);
    for (let j = i + 1; j < n; j++)
      if (!seen.has(j) && reach[i]!.has(j) && reach[j]!.has(i)) {
        group.push(j);
        seen.add(j);
      }
    groups.push(group.map((x) => x + 1));
  }
  return groups;
}

/** Every batch fault, in behaviour 6 order: each slice's faults prefixed by its rank, then the
 *  batch's own (zero slices, then cycles). Empty = the batch holds. */
export function validateLot(slices: SliceDraft[]): string[] {
  const faults: string[] = [];
  slices.forEach((slice, i) => {
    for (const f of validateSlice(slice, slices.length)) faults.push(`slice ${i + 1}: ${f}`);
  });
  if (slices.length === 0) faults.push("no slice in the batch");
  for (const group of cycles(slices))
    faults.push(`blockers in a cycle: slices ${group.join(", ")}`);
  return faults;
}

export type ApproveResult =
  | { ok: true; created: string[] }
  | { ok: false; status: 400 | 404 | 409 | 422; error: string; faults: string[] };

/**
 * The operator's single gesture: approve the batch of a Breakdown step in review.
 *
 * All or nothing. Refused, nothing is created and the step stays in review; accepted, the slices
 * exist, Wiki waits for all of them, and Breakdown is done, in that order, in one transaction.
 */
export function approveLot(taskId: string): ApproveResult {
  const task = taskById(taskId);
  if (!task) return { ok: false, status: 404, error: "task not found", faults: [] };
  if (!lotStep(task))
    return {
      ok: false,
      status: 400,
      error: "this step does not approve a batch of slices",
      faults: [],
    };
  // "Already done" before "not in review", because that is the case that happens: a second
  // approval is a double click or a stale tab, and the message must say the batch already went
  // through, not that a status does not fit.
  if (task.status === TASK_STATUS.done)
    return {
      ok: false,
      status: 409,
      error: "the step is already done: its batch has already been approved",
      faults: [],
    };
  if (task.status !== TASK_STATUS.review)
    return {
      ok: false,
      status: 409,
      error: "the step is not in review: only a Breakdown in review approves its batch",
      faults: [],
    };

  const read = readLot(task);
  if (!read.ok) {
    recordLotRefusal(task.id, [read.fault]);
    return { ok: false, status: 422, error: "batch refused", faults: [read.fault] };
  }
  const faults = validateLot(read.slices);
  if (faults.length > 0) {
    recordLotRefusal(task.id, faults);
    return { ok: false, status: 422, error: "batch refused", faults };
  }

  // The slices' agent is resolved before the transaction, for the whole batch, the way launching
  // a chain resolves its steps: a batch half created because the eighth slice has no agent is
  // exactly what behaviour 5 forbids.
  const agents = agentsOfProject(task.projectId);
  let bindings: Record<string, string> = {};
  try {
    bindings = JSON.parse(projectChainBindings(task.projectId) ?? "{}") as Record<string, string>;
  } catch {
    // Unreadable mapping: catalogue fallback, like an absent mapping.
  }
  const resolved = resolveStepAgent({ agentName: BUILD_ROLE, role: BUILD_ROLE }, agents, bindings);
  if (!resolved.ok) {
    const fault = `no agent for the “${BUILD_ROLE}” role: map it in the project's Chains settings`;
    return { ok: false, status: 422, error: fault, faults: [fault] };
  }

  const now = new Date();
  const count = read.slices.length;
  const { created, released } = inLotTransaction((tx) => {
    const ids = read.slices.map(() => nanoid(10));
    read.slices.forEach((slice, i) => {
      const criteria = readCriteria({ validatedBy: slice.validatedBy, items: slice.items });
      insertSliceTask(tx, {
        id: ids[i]!,
        projectId: task.projectId,
        name: `Slice ${i + 1}/${count} — ${String(slice.label).trim()}`,
        description: String(slice.outcome).trim(),
        status: TASK_STATUS.todo,
        // Offset by `i` like chain steps: slices keep batch order in the todo column, where they
        // all arrive at the same instant.
        boardOrder: now.getTime() + i,
        assigneeAgentId: resolved.agentId,
        // A slice carries criteria, so it is a gated step (behaviour 9): its agent hands it to
        // review, the operator judges it.
        approvalGate: true,
        criteria: criteria ? JSON.stringify(criteria) : null,
        // The run's, not the chain's: the artifacts folder is the run's (spec.md and the edges
        // file live there), and `templateId` keeps the template's automatic chaining. No
        // `stepIndex`: a slice is not a template step.
        templateId: task.templateId,
        templateRunId: task.templateRunId,
        expectedArtifacts: "[]",
        createdAt: now,
        updatedAt: now,
      });
    });
    // 1. Links between slices, once every row exists (a slice can be blocked by a higher-ranked
    //    one, and the FK requires it to exist).
    read.slices.forEach((slice, i) => {
      for (const rank of declaredRanks(slice, count)) addBlocker(ids[i]!, ids[rank - 1]!, tx);
    });
    // 2. Wiki blocked by every slice. "Wiki" reads as whatever Breakdown still holds: if the
    //    operator already moved it to done, its link was consumed then, there is no dependent,
    //    and no link is added. That is exactly behaviour 5's exception, without naming a step.
    for (const dependentId of dependentsOf(task.id))
      for (const id of ids) addBlocker(dependentId, id, tx);
    // 3. Only now is Breakdown done. `settleDone` consumes the Breakdown → Wiki link; Wiki is not
    //    released because the slices have held it since step 2.
    applyTaskTransition(task.id, TASK_MOVE.finish, {}, now);
    return { created: ids, released: settleDone(task.id) };
  });
  // The done's follow-ups run outside the transaction, like the three other paths: wake-ups,
  // cleanup, and launching what this done released.
  onTaskDone(task.id, released);
  return { ok: true, created };
}
