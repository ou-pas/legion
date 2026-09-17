// Task proposal by an agent (MCP `propose_task`): the relay for work found out of scope (a bug seen
// in passing, a boundary relay like the 23/08 one on tasks #24/#25/deFKzrrVV_) which, before this
// module, ended in a report nobody re-reads. Three non-negotiable guardrails, all enforced here
// (never in an agent prompt):
//
//  1. always created in `later`, never `todo`/`doing`: the automatic path (queue, scheduler)
//     ignores `later` by construction (see lifecycle.ts); explicitly `queued: false` too, so no
//     coincidence of defaults is relied on.
//  2. never assigned: `assigneeAgentId` stays NULL. `agentName` is only a text suggestion read by
//     the human (task-propose.test.ts checks it); runner/manager.ts refuses to launch a task
//     without an assignee anyway ("task has no assigned agent").
//  3. a per-session cap (anti-spam): beyond PROPOSAL_CAP_PER_SESSION, the proposal is refused (429)
//     rather than flooding the later column.
//
// `blocking` (25/08) touches none of the three: the filed task stays `later` and unassigned. It
// writes a dependency on the origin task, the one case the tool could not express: "this must go
// before what I am doing".
//
// `blockerIds` (08/09) writes the other edge, the missing one: order between filings. An agent
// filing several tasks at once (an interview slicing its spec) had no way to state their order,
// and they always arrived side by side. It carries the module's fourth guardrail, stated on the
// field: you only order what you filed yourself.
import { nanoid } from "nanoid";
import type { schema } from "../shared/db.js";
import { validateBlockerLinks } from "./blockers.js";
import { readCriteria, validateSlice } from "./criteria.js";
import { TASK_STATUS } from "./lifecycle.js";
import {
  findSessionRow,
  findTaskRow,
  insertProposedTask,
  projectAgentNames,
  sessionDepositIds,
} from "./task-propose-store.js";
import { COMPLEXITIES, COMPLEXITY } from "./task-scales.js";
import { PRIORITY } from "./task-scales.js";
import { BRANCH_TYPE } from "./task-branch.js";

type TaskRow = typeof schema.tasks.$inferSelect;

/** A named refusal, ready to become a 400: the shape both module guards and `validateBlockerLinks`
 *  return. */
type Fault = { status: 400; error: string };

export type ProposeTaskInput = {
  name: string;
  brief: string;
  complexity?: "low" | "med" | "high";
  /** A suggestion, never an assignment. The human decides (see the 23/08 task, boundary relay). */
  agentName?: string;
  /** The filed work must go before the work it came from (25/08). The origin task then becomes
   *  blocked by the new one: a `task_blockers` link holds it.
   *
   *  Why the flag exists: on 25/08 the front agent shipped the Environments screen while filing, in
   *  the same session, "no server route exists for /api/environments". The two tasks went their own
   *  ways, the parent went `done`, and the shipped screen talks to routes that do not exist.
   *  `propose_task` could only say "there is extra work"; it lacked "this must go first".
   *
   *  The flag launches nothing and assigns nothing: the module's three guardrails hold. It writes a
   *  dependency the board already reads: a blocked task is never due, and the blocker's `done`
   *  releases its dependents. */
  blocking?: boolean;
  /** Order between filings (08/09): tasks already filed by this session that must go before this
   *  one. `blocking` could only say "this goes before what I do", the only expressible edge, so two
   *  filings from one session always arrived side by side, unordered, whatever their real
   *  dependency.
   *
   *  What revealed it: an interview on 08/09 ("Add language switching to the Home page") filed four
   *  tasks, one of which, a native review of the translations, waits for the other three (reviewing
   *  translations that do not exist reviews nothing). The agent had no way to write that, although
   *  the `grilling` skill asked it to.
   *
   *  Restricted to this session's filings, the module's fourth guardrail: an agent orders the work it
   *  just filed, it does not set a dependency on a project task it did not create; that is the
   *  operator's job (`PATCH /api/tasks/:id`, `addBlockerIds`). Beyond that, `validateBlockerLinks`
   *  applies as for an HTTP call: existence, project, blocker already done, cycle. */
  blockerIds?: string[];
  /** The filed task's contract, `{ validatedBy, items: [{ text, mode, edge? }] }`: the leftover of a
   *  partial slice (behaviour 10), the criteria it did not meet, with their modes and its validation
   *  command. `unknown` rather than `Criteria`, because it comes from an agent's JSON body:
   *  `validateSlice` decides, not the type.
   *
   *  A task filed with criteria carries a gate: a leftover is a smaller slice, and a slice is judged
   *  by the human on the declared evidence. */
  criteria?: unknown;
};

export type ProposeTaskResult =
  | { ok: true; task: TaskRow; blocked: boolean; warning?: string }
  | { ok: false; status: 400 | 404 | 429; error: string };

export const PROPOSAL_NAME_MAX = 200;
/** 20,000, not 8,000: since discussion mode, a filed task's brief is the spec (D3/D11 of
 *  /artifacts/rtQLldYSm2/spec.md). A task cannot read another's artifacts, but it always reads its
 *  own brief: the only channel through which an interview reaches the work it prepares. That very
 *  spec showed it: the implementation task had to be condensed to fit under 8,000 and points to a
 *  file the next task must open. This cap stays a cap: it bounds an agent-written field, not free
 *  human text. */
export const PROPOSAL_BRIEF_MAX = 20_000;
export const PROPOSAL_AGENT_NAME_MAX = 200;
/** Anti-spam: a session abusing `propose_task` (instead of `inbox_send` for a mere report) must not
 *  drown the later column.
 *
 *  It was 5, and that was too low (09/09). The number dated from when filing a task was a side
 *  gesture (a bug seen in passing, a boundary relay). Since then slicing became a use in its own
 *  right: the `plan` agent and a chain's Breakdown step exist for it, and real work makes ten to
 *  twenty slices, not five.
 *
 *  The day it cost: re-slicing "Nav tidy-up 1/5". The plan produced seven batches, checked one by one
 *  in the code, with their files and criteria. Five went through, the last two were refused, and the
 *  agent had to write in its own plan "F and G still to create by hand". The work was right and
 *  complete; the pipe was too narrow. A cap cutting a slicing in half protects nothing: it shifts
 *  work to the human without saying so on screen.
 *
 *  Why 30 and not infinity: the guard stays useful against a loop (an agent refiling endlessly), but
 *  it must bound accidents, never work. Thirty is above any plausible slicing and far below a
 *  runaway. The three other guards (never launched, never assigned, always `later`) are what really
 *  protects, and they depend on no number. */
export const PROPOSAL_CAP_PER_SESSION = 30;

/** The agent suggestion, resolved against the project's real agents (24/08): the name as the project
 *  writes it, or the warning saying why it was dropped. It used to be free text: three proposals on
 *  23/08 suggested "web" and "senior-dev-web", two agents that do not exist; harmless (never an
 *  assignment) but misleading for the human reading the card.
 *
 *  An unknown name is dropped, never fatal: the proposal is worth far more than its suggestion, and
 *  refusing it whole would lose the discovered work. The agent gets the warning with the list of
 *  valid names, which stops it from trying again. Only length refuses (400). */
function resolveSuggestion(
  requested: string | undefined,
  projectId: string,
): { name: string | null; warning?: string } | Fault {
  const trimmed = requested?.trim();
  if (!trimmed) return { name: null };
  if (trimmed.length > PROPOSAL_AGENT_NAME_MAX)
    return {
      status: 400,
      error: `agentName too long (${trimmed.length} characters, maximum ${PROPOSAL_AGENT_NAME_MAX})`,
    };
  const names = projectAgentNames(projectId);
  // The project's case wins, not the agent's.
  const match = names.find((n) => n.toLowerCase() === trimmed.toLowerCase());
  if (match) return { name: match };
  return {
    name: null,
    warning:
      `agent “${trimmed}” unknown to this project: suggestion dropped (the task is created). ` +
      `Agents available: ${names.join(", ") || "none"}.`,
  };
}

/** What refuses a `blockerIds`, or `null` if it holds. Called before the insert: a refusal must not
 *  leave a created task without its order behind (the agent would refile, and the cap would count
 *  both). The task not existing yet bothers no `validateBlockerLinks` rule: a new id can neither
 *  block itself nor close a cycle.
 *
 *  The first guard is the module's fourth guardrail, and it is ours: only this session's filings can
 *  be ordered. An agent arranges the work it just filed; setting a dependency on a project task it
 *  did not create stays the operator's gesture (`PATCH /api/tasks/:id`, `addBlockerIds`). The other
 *  guards are an HTTP call's. */
function blockerFault(
  task: { id: string; projectId: string },
  requested: string[],
  deposits: string[],
): Fault | null {
  const notOurs = [...new Set(requested)].filter((id) => !deposits.includes(id));
  if (notOurs.length > 0)
    return {
      status: 400,
      error:
        `blockerIds only accepts tasks proposed by this session: ${notOurs.join(", ")}` +
        " — to make your CURRENT task wait, use blocking: true; to depend on a task you did" +
        " not propose, ask the operator (inbox_send)",
    };
  return validateBlockerLinks(task.id, requested, task.projectId);
}

/** The cleaned title, or its refusal (empty, too long). */
function resolveName(input: ProposeTaskInput): { name: string } | Fault {
  const name = input.name?.trim();
  if (!name) return { status: 400, error: "empty name" };
  if (name.length > PROPOSAL_NAME_MAX)
    return {
      status: 400,
      error: `name too long (${name.length} characters, maximum ${PROPOSAL_NAME_MAX})`,
    };
  return { name };
}

/** The cleaned brief, or its refusal. A filed task's brief is its spec (see `PROPOSAL_BRIEF_MAX`);
 *  refusing it empty or too long protects that channel. */
function resolveBrief(input: ProposeTaskInput): { brief: string } | Fault {
  const brief = input.brief?.trim();
  if (!brief) return { status: 400, error: "empty brief" };
  if (brief.length > PROPOSAL_BRIEF_MAX)
    return {
      status: 400,
      error: `brief too long (${brief.length} characters, maximum ${PROPOSAL_BRIEF_MAX})`,
    };
  return { brief };
}

/** The declared complexity, or the default, refused if not on the scale. */
function resolveComplexity(
  input: ProposeTaskInput,
): { complexity: (typeof COMPLEXITIES)[number] } | Fault {
  const complexity = input.complexity ?? COMPLEXITY.med;
  if (!COMPLEXITIES.includes(complexity))
    return { status: 400, error: `invalid complexity: “${complexity}”` };
  return { complexity };
}

/** A leftover's criteria (behaviour 10), validated and serialised like a slice's (behaviour 6) but
 *  without batch-only fields: a leftover has no rank and no declared blockers; what it blocks is the
 *  slice it came from, and `blocking` writes that. `null` if `input.criteria` is absent: most filings
 *  carry none. */
function resolveCriteria(input: ProposeTaskInput): { criteria: string | null } | Fault {
  if (input.criteria === undefined || input.criteria === null) return { criteria: null };
  const draft = input.criteria;
  const faults = validateSlice(
    typeof draft === "object" && draft !== null ? (draft as Record<string, unknown>) : {},
  );
  if (faults.length > 0) return { status: 400, error: `invalid criteria: ${faults.join(" · ")}` };
  const read = readCriteria(draft);
  // `validateSlice` named everything, so `readCriteria` should refuse nothing more: the only case
  // reaching it is a shape validation tolerates and the column does not carry.
  if (!read) return { status: 400, error: "unreadable criteria" };
  return { criteria: JSON.stringify(read) };
}

/** The row to insert, assembled from already validated fields: no rule here, only the shape
 *  `insertProposedTask` expects. */
function buildProposedTaskRow(
  sessionId: string,
  originTask: TaskRow,
  fields: {
    name: string;
    brief: string;
    complexity: (typeof COMPLEXITIES)[number];
    criteria: string | null;
    suggestedAgentName: string | null;
  },
): TaskRow {
  const now = new Date();
  return {
    id: nanoid(10),
    projectId: originTask.projectId,
    name: fields.name,
    description: fields.brief,
    status: TASK_STATUS.later,
    settledOutcome: null, // proposed, never settled: no notice to carry
    // No runner imposed: a proposed task does not pick the machine of the task filing it; the choice
    // is an operator gesture, and the queue routes freely meanwhile.
    chosenRunnerId: null,
    boardOrder: now.getTime(),
    archived: false,
    complexity: fields.complexity,
    priority: PRIORITY.med,
    queued: false, // invariant §2: never queued, not even by implicit default
    prUrls: "[]",
    externalRef: null,
    assigneeAgentId: null, // invariant §2: never assigned by the agent
    modelOverride: null,
    // A task filed with criteria is a gated step (behaviour 9): its agent cannot move it to done.
    // Without criteria nothing changes.
    approvalGate: fields.criteria !== null,
    readOnly: false,
    goalId: null,
    templateId: null,
    templateRunId: null,
    stepIndex: null,
    expectedArtifacts: "[]",
    stepPrompt: null,
    scheduledAt: null,
    proposedByAgent: true,
    proposedBySessionId: sessionId,
    proposedFromTaskId: originTask.id,
    proposedAgentName: fields.suggestedAgentName,
    criteria: fields.criteria,
    // v50: a filed task does not go through the classifier: nobody judged its type, and `chore` is
    // the honest fallback. Its branch is set at its first derivation, like the others.
    type: BRANCH_TYPE.chore,
    branch: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function proposeTask(sessionId: string, input: ProposeTaskInput): ProposeTaskResult {
  const session = findSessionRow(sessionId);
  if (!session) return { ok: false, status: 404, error: "session not found" };

  const originTask = findTaskRow(session.taskId);
  if (!originTask) return { ok: false, status: 404, error: "origin task not found" };

  const nameField = resolveName(input);
  if ("status" in nameField) return { ok: false, ...nameField };
  const briefField = resolveBrief(input);
  if ("status" in briefField) return { ok: false, ...briefField };
  const complexityField = resolveComplexity(input);
  if ("status" in complexityField) return { ok: false, ...complexityField };

  const suggestion = resolveSuggestion(input.agentName, originTask.projectId);
  if ("status" in suggestion) return { ok: false, ...suggestion };
  const { name: suggestedAgentName, warning } = suggestion;

  const criteriaField = resolveCriteria(input);
  if ("status" in criteriaField) return { ok: false, ...criteriaField };

  // Read on each call rather than kept in process memory: the cap must hold across a resume (new
  // container, same sessionId) and a control plane restart. The same list serves the cap and
  // `blockerIds` (see `blockerFault`).
  const deposits = sessionDepositIds(sessionId);
  if (deposits.length >= PROPOSAL_CAP_PER_SESSION)
    return {
      ok: false,
      status: 429,
      error: `proposal cap reached for this session (${PROPOSAL_CAP_PER_SESSION}) — no task spam`,
    };

  const row = buildProposedTaskRow(sessionId, originTask, {
    name: nameField.name,
    brief: briefField.brief,
    complexity: complexityField.complexity,
    criteria: criteriaField.criteria,
    suggestedAgentName,
  });

  const linkFault = blockerFault(row, input.blockerIds ?? [], deposits);
  if (linkFault) return { ok: false, ...linkFault };

  // The dependency on the origin task (`blocking` behaviour) adds to what already holds it. Until
  // v45 a second blocking filing was refused with a warning: the single column held one blocker, and
  // setting it would have silently replaced a dependency decided elsewhere (by a chain or the human).
  // With the graph a second link replaces nothing: the origin waits for both, and the last to finish
  // releases it (behaviour 8). It is also what a leftover needs: a partial slice finding two
  // remainders files both before itself, not one.
  const blocked = Boolean(input.blocking);
  const created = insertProposedTask(row, input.blockerIds ?? [], blocked ? originTask.id : null);

  return warning
    ? { ok: true, task: created, blocked, warning }
    : { ok: true, task: created, blocked };
}
