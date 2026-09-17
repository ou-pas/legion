// Templates & chains — a template instantiates into a chain of tasks (step N+1
// blocked by N). Gates and expected artifacts are enforced by the API, never by prompts.
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { schema } from "../shared/db.js";
import {
  activityBodiesOfTask,
  agentsOfProject,
  chainTemplateById,
  clearSchedule,
  inChainTransaction,
  inSettleTransaction,
  insertStepTask,
  isDemoProject,
  projectChainBindings,
  projectPaths,
  sessionsOfTask,
  taskById,
  tasksAmongInStatus,
  tasksInStatus,
} from "./templates-store.js";
import { projectRoot } from "../projects/fs-acl.js";
import { artifactsPath } from "../tasks/artifacts/scope.js";
import {
  addBlocker,
  blockedTaskIds,
  consumeBlockersOf,
  releaseDependentsOf,
} from "../tasks/blockers.js";
import { pumpQueue, runTask } from "../sessions/runner/manager.js";
// Static since 06/09. These four were `import()`s dodging the cycle templates → wait-for-task →
// inbox → manager → templates; the `SessionResumer` port cut inbox → manager. Their `.catch`es
// stay: these are detached cleanup jobs, and an unguarded promise is a defect (rule of 23/08).
import { wakeWaitersOf } from "../sessions/wait-for-task.js";
import { releaseWorkspacesOfTask } from "../sessions/runner/workspace.js";
import { updateProjectContext } from "../capabilities/capabilities.js";
import { wakeDueQuotaPauses } from "../sessions/quota-pause.js";
import { resumeUpdatePauses } from "../updates/graceful.js";
import { updateInFlight } from "../updates/updates.js";
import { runtimeMode } from "../updates/stamp.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { done, refuse, type Result } from "../http/from-result.js";
import { createLogger } from "../shared/log.js";

// Each log line guards the transaction around it (a task's done, the scheduler tick) against a
// side failure. The fact they accompany already has its trace in `control_events`.
const log = createLogger("chains");

export type TemplateStep = {
  name: string;
  agentName: string;
  /** v29: the step's role, key of the project mapping (chain_bindings). Optional: the agent name
   *  is the implicit role (`role ?? agentName`). */
  role?: string;
  approvalGate: boolean;
  expectedArtifacts: string[];
  prompt: string;
  /** The step whose review ends by approving a batch of slices (`feature` chain, Breakdown step):
   *  only that gesture finishes it, and it instantiates the slices between it and the next step.
   *  A flag rather than a hard-coded step name, because an installed copy is edited in place and a
   *  label is not an identity. Absent = ordinary step. */
  approvesLot?: boolean;
};

/** v29: a chain step's agent. The project mapping first (role → agentId), the catalogue as
 *  fallback (agent name), same cascade as resolveModel. An error is named and returned when the
 *  chain launches, never discovered mid-run. */
export function resolveStepAgent(
  step: { agentName: string; role?: string },
  agents: readonly { id: string; name: string }[],
  bindings: Record<string, string>,
): { ok: true; agentId: string } | { ok: false; error: string } {
  const role = step.role ?? step.agentName;
  const bound = bindings[role];
  if (bound !== undefined) {
    const hit = agents.find((a) => a.id === bound);
    if (!hit)
      return {
        ok: false,
        error: `the “${role}” role is mapped to an agent that no longer exists — fix the project's Chains settings`,
      };
    return { ok: true, agentId: hit.id };
  }
  const byName = agents.find((a) => a.name === step.agentName);
  if (!byName) return { ok: false, error: `agent '${step.agentName}' not found` };
  return { ok: true, agentId: byName.id };
}

/** Mapping validation (project PATCH), same contract as validateModelRoutingInput: the object is
 *  replaced whole, `null` clears everything. Each value must be an agent of this project: another
 *  project's id would leak across the boundary, an unknown id is a mapping dead on arrival. */
export function validateChainBindingsInput(
  input: unknown,
  projectAgents: readonly { id: string; name: string }[],
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input))
    return { ok: false, error: "chainBindings must be an object { role: agentId }" };
  const out: Record<string, string> = {};
  for (const [role, agentId] of Object.entries(input as Record<string, unknown>)) {
    if (!role.trim()) return { ok: false, error: "an empty role is not a role" };
    if (agentId === null || agentId === undefined) continue; // absent key = catalogue fallback
    if (typeof agentId !== "string" || !agentId.trim())
      return {
        ok: false,
        error: `chainBindings.${role} must be an agent id (a non-empty string)`,
      };
    if (!projectAgents.some((a) => a.id === agentId))
      return { ok: false, error: `chainBindings.${role}: agent unknown to this project` };
    out[role.trim()] = agentId;
  }
  return { ok: true, value: out };
}

/** A chain, or the named reason it is refused. The three refusals used to be bare `Error`s a route
 *  `catch` flattened to 400: a missing template is a 404, a bad step mapping a request to fix. */
export function instantiateTemplate(
  templateId: string,
  request: string,
): Result<{ runId: string; taskIds: string[] }> {
  const tpl = chainTemplateById(templateId);
  if (!tpl) return refuse(404, "template not found");
  const steps = JSON.parse(tpl.steps) as TemplateStep[];
  if (steps.length === 0) return refuse(400, "template has no steps");

  const agents = agentsOfProject(tpl.projectId);
  // v29: resolved here, at launch, for every step before creating anything: a chain whose step 4
  // is badly mapped refuses whole instead of turning up orphaned mid-run. Created tasks carry a
  // frozen agentId, so changing the mapping later re-resolves nothing.
  let bindings: Record<string, string> = {};
  try {
    bindings = JSON.parse(projectChainBindings(tpl.projectId) ?? "{}") as Record<string, string>;
  } catch {
    // Unreadable mapping (damaged database): catalogue fallback, like an absent mapping.
  }
  const stepAgentIds: string[] = [];
  for (const s of steps) {
    const r = resolveStepAgent(s, agents, bindings);
    if (!r.ok) return refuse(400, r.error);
    stepAgentIds.push(r.agentId);
  }

  const runId = nanoid(10);
  const now = new Date();
  const taskIds: string[] = [];
  let previousId: string | null = null;

  // Transaction (review P3 #8): a chain is all-or-nothing, no orphan steps on a mid-loop throw.
  inChainTransaction((tx) => {
    steps.forEach((step, i) => {
      const id = nanoid(10);
      insertStepTask(tx, {
        id,
        projectId: tpl.projectId,
        name: `Step ${i + 1}/${steps.length} — ${step.name} · ${request.slice(0, 60)}`,
        description: request,
        status: TASK_STATUS.todo,
        // Initial rank (v21): `now` is shared by every step, so offset by `i` to keep chain order
        // in the todo column instead of stacking them on one rank.
        boardOrder: now.getTime() + i,
        assigneeAgentId: stepAgentIds[i]!,
        modelOverride: null,
        approvalGate: step.approvalGate,
        templateId: tpl.id,
        templateRunId: runId,
        stepIndex: i,
        expectedArtifacts: JSON.stringify(step.expectedArtifacts ?? []),
        stepPrompt: step.prompt,
        createdAt: now,
        updatedAt: now,
      });
      // The link to the previous step, in the same transaction, through the `tx` passed to
      // `addBlocker` (05/09), not because `db` and `tx` happen to share a better-sqlite3 handle
      // (true, but the library guarantees it, not this code).
      if (previousId) addBlocker(id, previousId, tx);
      taskIds.push(id);
      previousId = id;
    });
  });
  return done({ runId, taskIds });
}

/** Missing expected artifacts for a task, checked on disk (server-side, like the gates). */
export function missingArtifacts(taskId: string): string[] {
  const task = taskById(taskId);
  if (!task) return [];
  const expected = JSON.parse(task.expectedArtifacts) as string[];
  if (expected.length === 0) return [];
  const project = projectPaths(task.projectId);
  if (!project) return expected;
  const root = projectRoot(project.slug, project.fsRoot);
  const dir = path.join(root, artifactsPath(task));
  return expected.filter((name) => !fs.existsSync(path.join(dir, name)));
}

/** Batch 3: one line per real done task in the project's CHANGELOG.md (human history). */
function appendChangelog(task: typeof schema.tasks.$inferSelect): void {
  try {
    const project = projectPaths(task.projectId);
    if (!project) return;
    const root = projectRoot(project.slug, project.fsRoot);
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, "CHANGELOG.md");
    const day = new Date().toISOString().slice(0, 10);
    const ref = task.externalRef
      ? ` (${(JSON.parse(task.externalRef) as { identifier?: string }).identifier ?? ""})`
      : "";
    const prs = (JSON.parse(task.prUrls) as { url: string }[]).map((p) => p.url).join(" ");
    // Flattened to one line: an injected \n would forge the CHANGELOG (review lot3 #12).
    const cleanName = task.name
      .replace(/^🎯 /, "")
      .replace(/\s+/g, " ")
      .trim();
    const line = `- ${day} — ${cleanName}${ref}${prs ? ` · ${prs}` : ""}\n`;
    if (!fs.existsSync(file))
      fs.writeFileSync(file, `# Changelog\n\n_History of Legion tasks._\n\n`);
    fs.appendFileSync(file, line);
  } catch (err) {
    log.warn("changelog not written", { error: (err as Error)?.message });
  }
}

/** The transactional part of done, to call inside the transaction that marks the task done, right
 *  after the status update ("decoupe" spec, behaviour 8: "decided in the transaction that finishes
 *  each blocker"). Links holding it are consumed with it whatever its blockers' state, and so are
 *  links where it is the blocker, whether or not the dependent has other blockers. Returns the
 *  tasks this done releases: those nothing holds any more. The last blocker releases, exactly
 *  once, in any order.
 *
 *  Separate from `onTaskDone` because the three paths that finish a task (operator PATCH, Kanban
 *  drop, the agent's `/internal`) each have their own status update, and consumption must join
 *  that update's transaction. The follow-ups do not belong there: a session provisioned under a
 *  rolled-back transaction would be a container without a task. The store's transaction becomes a
 *  savepoint under a caller's transaction (better-sqlite3 nests), and keeps both consumptions
 *  atomic if a caller forgets its own. */
export function settleDone(taskId: string): string[] {
  return inSettleTransaction(() => {
    consumeBlockersOf(taskId);
    return releaseDependentsOf(taskId);
  });
}

/** What the model reads to enrich the context: the note history plus this done's note, passed in.
 *
 *  Passed, not re-read: that is the 30/08 fix. `update_task` inserted the note into `task_activity`
 *  after calling `onTaskDone`, which re-read the table without it. On a task whose only note that
 *  was (a task run on its own, the common case) the model got "(none)" and rightly answered there
 *  was nothing to add. Silent on both outcomes, nobody could see it. Moving the insert before the
 *  call would have left the trap: an invariant that depends on the order of two lines breaks at
 *  the next refactor. */
export function contextNotes(previous: readonly string[], note?: string): string {
  return [...previous, note?.trim()].filter(Boolean).join(" | ");
}

/** The done's follow-ups, outside the transaction: wake-ups, cleanup, context, changelog, and
 *  launching what this done released. `released` is what `settleDone` returned inside the status
 *  transaction: one decides, the other acts. */
export function onTaskDone(taskId: string, released: readonly string[], note?: string): void {
  const task = taskById(taskId);
  if (!task) return;
  // v26: sessions asleep on this task (`wait_for_task`) wake here, through the hook that already
  // unblocks chains: one definition of "X is done".
  void wakeWaitersOf(taskId, TASK_STATUS.done).catch((err: unknown) =>
    log.error("waking waiting sessions failed", { taskId, error: (err as Error)?.message }),
  );
  // D13: a done task's `/workspace` has no reader left. Nobody resumes those sessions, and a new
  // run opens a new session, hence a new folder. Cleanup, never a reason to stop a task finishing.
  try {
    releaseWorkspacesOfTask(taskId);
  } catch (err: unknown) {
    log.warn("releasing the workspace on done failed", {
      taskId,
      error: (err as Error)?.message,
    });
  }
  // Living context (v11): a real done task may enrich the project context. Fire-and-forget, a
  // failure never affects the chain.
  const sessions = sessionsOfTask(taskId);
  if (sessions.length > 0 && sessions.every((s) => !s.mock)) {
    const notes = contextNotes(activityBodiesOfTask(taskId), note);
    void updateProjectContext(task.projectId, task.name, notes).catch((err) =>
      log.warn("context update failed", { taskId, error: (err as Error)?.message }),
    );
    appendChangelog(task); // batch 3: human history of runs
  }
  // A blocker's done releases all its dependents, not only a chain's next step (23/08: between two
  // free tasks the dependency never lifted, since the field was only cleared on the chain path).
  //
  // The launch filter (slice 02): `settleDone` consumed every dependent's links whatever its
  // status, since a block is an event, not a state (behaviour 8). But only `todo` dependents start.
  // `later` is the only parking spot and never moves on its own; a dependent already doing, in
  // review or done has nothing to launch. A free todo dependent is picked up by the queue (todo is
  // the queue); a chain step keeps its driver: autoRunNext decides.
  if (released.length === 0) return;
  const dependents = tasksAmongInStatus(released, TASK_STATUS.todo);
  if (dependents.length === 0) return;
  if (!task.templateRunId) {
    // Free tasks: no direct launch here. The queue takes them in its own order (priority then
    // age), within capacity.
    pumpQueue();
    return;
  }
  const next = dependents[0];
  if (!next) return;
  // Honor the template's autoRunNext flag (review P3 #6) — false = unblocked but manual.
  if (task.templateId) {
    const tpl = chainTemplateById(task.templateId);
    if (tpl && !tpl.autoRunNext) return;
  }
  // Propagate the run's mock-ness (review P3 #9): a mock chain must not cascade real sessions.
  const lastSession = sessionsOfTask(taskId)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .pop();
  // enqueueOnFull (review lot4 #3): at full capacity the step is queued instead of stalling the chain.
  void runTask(next.id, {
    ...(lastSession ? { mock: lastSession.mock } : {}),
    enqueueOnFull: true,
  }).catch((err) =>
    log.error("automatic run of the next step failed", {
      taskId: next.id,
      error: (err as Error).message,
    }),
  );
}

/** One-shot scheduler: launch due tasks (todo, unblocked, no active session). */
export function startScheduler(): void {
  setInterval(() => {
    const now = Date.now();
    // Scheduled wake-ups (v28): an out-of-quota pause resumes on its own when the window resets.
    // A failed wake-up must never bring down the scheduled-task tick.
    try {
      wakeDueQuotaPauses(now);
    } catch (err: unknown) {
      log.warn("out-of-quota wake-ups failed", { error: (err as Error).message });
    }
    // Sessions suspended by an update resume here (08/09), same shape as the wake-up above. Here
    // and not at server start: the new control plane is up while the fleet's images are still
    // rebuilding, and resuming then would start containers on a stale payload. `updateInFlight`
    // covers the whole script (see updates/graceful.ts).
    void resumeUpdatePauses(() => updateInFlight(runtimeMode())).catch((err: unknown) =>
      log.warn("resumes after update failed", { error: (err as Error).message }),
    );
    // Todo is the queue: the tick is also the pump's safety net. Creation in todo, moves to todo,
    // unblocking, server restart all converge here within 30 s without instrumenting each route.
    // The pump is idempotent and reentrant.
    pumpQueue();
    const rank: Record<string, number> = { high: 3, med: 2, low: 1 };
    // v13: when several schedules fall due together, higher priority first. The `status = todo`
    // scope is what keeps `later` out of automatic launches: a `later` task is never due, even
    // with a scheduledAt.
    const blocked = blockedTaskIds(); // a link = not due, whatever the blocker's state
    const due = tasksInStatus(TASK_STATUS.todo)
      .filter(
        (t) =>
          t.scheduledAt &&
          t.scheduledAt.getTime() <= now &&
          !blocked.has(t.id) &&
          !isDemoProject(t.projectId),
      )
      .sort(
        (a, b) =>
          (rank[b.priority] ?? 2) - (rank[a.priority] ?? 2) ||
          a.scheduledAt!.getTime() - b.scheduledAt!.getTime(),
      );
    for (const t of due) {
      // Clear the schedule ONLY on successful launch (review P3 #3): a transient failure
      // (runner at capacity, docker down) must leave the task due for the next tick.
      void runTask(t.id)
        .then(() => clearSchedule(t.id, new Date()))
        .catch((err) =>
          log.error("running a due task failed", {
            taskId: t.id,
            error: (err as Error).message,
          }),
        );
    }
  }, 30_000).unref();
}
