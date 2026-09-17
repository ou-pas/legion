// The operator's three gestures on a session: launch it, resume it, stop it.
//
// This file was 1,637 lines before lot 11 and carried the whole launch. What left it, and where:
//   · `chosen-runner.ts` — which machine, and is it ready;
//   · `recovery.ts`      — what remains of dead sessions;
//   · `spec.ts` / `brief.ts` — what the container receives, and the text the agent reads;
//   · `lifecycle.ts`     — a session's life, from provisioning to its death certificate;
//   · `queue.ts`         — who waits their turn;
//   · `manager-store.ts` — every query of the family.
//
// The re-exports below are not a convenience: `runner/manager.js` is imported by eleven modules
// and twenty test files, and the domain's public surface was frozen for that work.
import { nanoid } from "nanoid";
import { publish } from "../../shared/events.js";
import { resolveModel } from "../../models/model.js";
import { hasCredential } from "../../projects/auth.js";
import { applyTaskTransition, markTaskStarted, TASK_MOVE } from "../../tasks/lifecycle.js";
import { blockersByTask, TaskBlockedError } from "../../tasks/blockers.js";
import { ACTIVE_STATUSES, markSessionTerminal, SESSION_STATUS } from "../session-terminal.js";
import { assertSessionWritable } from "../session-guard.js";
import { resumePrompt } from "../resume-prompt.js";
import { sessionImageFor } from "./image-preflight.js";
import { NoCapacityError } from "./launch-errors.js";
import { assertRunnerReadyOrRelease, pickRunnerRow } from "./chosen-runner.js";
import { runnerResources } from "../../infra/runner/limits.js";
import { updateSuspensionRefusal } from "../../updates/graceful.js";
import { warnIfGitIdentityUnlinked } from "../../projects/git-identity-check.js";
import { addNotice } from "../../inbox/notices.js";
import { expireStaleDiagnostics } from "../../inbox/diagnostics.js";
import { closeSessionInbox } from "../../inbox/session-close.js";
import { moveIssueInProgress } from "../../integrations/linear.js";
import { runnerProvider } from "./ports.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import { createLogger } from "../../shared/log.js";
import { titleExamplesFor } from "./brief.js";
import { briefAttachmentsSection, taskAttachments } from "../../tasks/attachments.js";
import {
  assertReposReachable,
  browserForSession,
  buildNetworkPolicy,
  buildSpec,
  effectiveRepoAccess,
  loadContext,
  sessionCallbackUrl,
} from "./spec.js";
import { runLifecycle } from "./lifecycle.js";
import { onTaskLaunch } from "./queue.js";
import { logControlEvent } from "../../events/control-log-store.js";
import {
  activeSessionOfTask,
  type AgentRow,
  insertSession,
  markSessionResuming,
  type ProjectRow,
  runnerRow as runnerRowOf,
  type RunnerRow,
  sessionRow,
  setTaskQueued,
  type TaskRow,
} from "./manager-store.js";

export { recoverOrphanSessions, reapDeadSessions } from "./recovery.js";
export { buildNetworkPolicy, browserForSession, sessionCallbackUrl } from "./spec.js";
export { runLifecycle } from "./lifecycle.js";
export { pumpQueue } from "./queue.js";

const log = createLogger("runner"); // the terminal; what gets reread goes through `logControlEvent`

/** What `runTask` returns instead of a session id when nothing started: the task went to the
 *  QUEUE. Named (03/09) because callers compared this literal, and a rename would have left them
 *  silently comparing against a value the function no longer returns. */
export const RUN_QUEUED = "queued";

// Invariant (review lot4 #8, rewritten 05/09): `runTask` RESERVES its slot (`insertSession()` as
// `starting`) BEFORE its first `await`. `pumpQueue` fires `void runTask(t.id)` in a loop and
// recounts load between calls through `pickRunnerRow`, which reads sessions from the database: any
// `await` before the insert hands control back to the loop before the session exists, and N tasks
// take one slot. It happened: the daemon probe added on 25/08 slipped in BEFORE the insert.
//
// What guarantees it now: the runner check (`assertRunnerReady`, the path's only `await`) comes
// AFTER the reservation, and a refusal RELEASES the slot through `markSessionTerminal`.
// `queue-race.test.ts` holds the proof with a probe left open while counting. Any other async
// resolution (network, KMS…) stays AFTER the insert, in buildSpec/runLifecycle.
/** The refusals that precede any launch, each naming what it refuses.
 *
 *  Demo project (v15) = READ-ONLY sandbox: no agent ever starts there, whatever the runner.
 *
 *  A blocked task does not launch, by hand or from the queue, while a blocker remains, and the
 *  refusal NAMES every blocker: "blocked by X" can be fixed, "blocked" can only be endured. A link
 *  means blocked, without rereading the blocker's status: unblocking is an event consumed at its
 *  done, not a recomputed state (tasks/blockers.ts).
 *
 *  `prMaintenance` (10/09) is the only exception, and it does not move the task forward. Resolving
 *  an open PR's conflict or catching up its red CI maintains work ALREADY DELIVERED; the blocker
 *  says when the task can be finished. Refusing them let a PR rot in conflict with no possible
 *  gesture (seen on `T6ywbnqS3Y`, blocked by a follow-up task that itself depended on its merge).
 *  Both callers (`resolveConflict`, `fixCi`) recheck the PR state on the forge before reaching
 *  here: the exception is bounded to that. */
function assertLaunchable(task: TaskRow, project: ProjectRow, prMaintenance: boolean): void {
  if (project.demo) throw new Error("Demo project: read only, no session is started.");
  const blockers = blockersByTask([task.id]).get(task.id) ?? [];
  if (blockers.length > 0 && !prMaintenance)
    throw new TaskBlockedError(
      `blocked by ${blockers.map((b) => `“${b.name}” (${b.status})`).join(", ")}`,
    );
  const running = activeSessionOfTask(task.id, ACTIVE_STATUSES);
  if (running) throw new Error(`task already has an active session (${running.id})`);
}

/** The machine, or the queue. The TASK's choice wins over the agent's preference, and it is hard:
 *  the more recent and more explicit gesture of the two (v66).
 *
 *  Returns `null` when the task went to the queue (v13): at full capacity it is queued rather than
 *  failed, and `pumpQueue` starts it when a slot frees. Goal tasks are driven by the orchestrator,
 *  never by the queue (review lot4 #6), and ONLY capacity leads there (launch-errors.ts): a
 *  sleeping machine or a full disk do not unblock by waiting, the task surfaces the error. */
function chooseRunnerOrEnqueue(
  task: TaskRow,
  agent: AgentRow,
  enqueueOnFull: boolean,
  image: string,
): RunnerRow | null {
  try {
    return pickRunnerRow(agent.runnerPreference, task.chosenRunnerId, image);
  } catch (err) {
    if (!(enqueueOnFull && !task.goalId && err instanceof NoCapacityError)) throw err;
    setTaskQueued(task.id, true, new Date());
    logControlEvent("info", "queue", `task ${task.id} queued: capacity full`, {
      taskId: task.id,
      agentName: agent.name,
    });
    return null;
  }
}

/** Linked Linear issue → In Progress. Fire-and-forget: a Linear failure never blocks the task, but
 *  it SHOWS, in the session trace and in the log. */
function moveLinkedIssueInProgress(sessionId: string, task: TaskRow, projectId: string): void {
  if (!task.externalRef) return;
  const ref = JSON.parse(task.externalRef) as { provider: string; issueId: string };
  if (ref.provider !== "linear") return;
  void moveIssueInProgress(projectId, ref.issueId).catch((err) => {
    const message = `Linear In Progress failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
    publish(sessionId, "run_warning", { message });
    logControlEvent("error", "integration", message, {
      taskId: task.id,
      sessionId,
      provider: "linear",
      issueId: ref.issueId,
    });
  });
}

export async function runTask(
  taskId: string,
  opts: { mock?: boolean; enqueueOnFull?: boolean; prMaintenance?: boolean } = {},
): Promise<string> {
  // Nothing new while suspending (08/09): `pumpQueue()` runs in every exit's `finally`, pauses
  // included, so without this refusal an update window would put as many sessions to sleep as it
  // wakes. HERE because queue, scheduler, chains and routes all go through this function; NAMED so
  // the pump requeues and a human reads why. Full reasoning in updates/graceful.ts.
  const suspension = updateSuspensionRefusal();
  if (suspension) throw new Error(suspension);
  const { task, agent, project } = loadContext(taskId);
  assertLaunchable(task, project, opts.prMaintenance ?? false);

  const access = effectiveRepoAccess(task, agent);
  assertReposReachable(agent, project, access);

  // Will this project's git identity be attributed by the forge? Asked HERE, once per project and
  // address, WITHOUT waiting for the answer: a warning, not a gate (reasoning in
  // git-identity-check.ts). Only when the session can commit; a read-only task signs nothing.
  if (access === "write") void warnIfGitIdentityUnlinked(project, addNotice);

  // Computed BEFORE the choice (12/09): `pickRunnerRow` needs it to prefer a machine that has it
  // rather than refuse one that does not (see chosen-runner.ts).
  const image = sessionImageFor(project);
  const runnerRow = chooseRunnerOrEnqueue(task, agent, opts.enqueueOnFull ?? false, image);
  if (!runnerRow) return RUN_QUEUED;
  const model = resolveModel(task, agent, project);
  const sessionId = nanoid(12);
  const callbackToken = nanoid(32);
  const now = new Date();
  const mock = opts.mock ?? !hasCredential(project.id);

  // The reservation (see the invariant above): this line precedes the first `await`, and it is
  // what `pickRunnerRow` counts for the queue's next candidate.
  insertSession({
    id: sessionId,
    taskId,
    agentId: agent.id,
    runnerId: runnerRow.id,
    model,
    status: SESSION_STATUS.starting,
    callbackToken,
    mock,
    startedAt: now,
  });

  await assertRunnerReadyOrRelease(sessionId, {
    runnerRow,
    image,
    taskId,
    agent,
    projectId: project.id,
  });
  // This transition used to be filtered on `status = 'todo'`: written for the normal case, it did
  // NOTHING, without an error, for the others. A task launched by hand from later stayed there
  // with a doing pill, and the board said the opposite of what happened. The rule lives in
  // lifecycle.ts, with one test per starting status.
  if (!markTaskStarted(taskId, now))
    log.warn("session started with no applicable status change", {
      sessionId,
      taskId,
      status: task.status,
    });
  // v30: a new session makes the task's still-open failure diagnostics stale, their gesture (run
  // again) just happened. Direct since 06/09 (see `inbox/diagnostics.ts`).
  expireStaleDiagnostics(taskId, sessionId);
  publish(sessionId, "status", {
    status: SESSION_STATUS.starting,
    model,
    runner: runnerRow.name,
    network: buildNetworkPolicy(agent).mode,
  });

  if (!mock) moveLinkedIssueInProgress(sessionId, task, project.id);

  const spec = buildSpec({
    sessionId,
    callbackToken,
    task,
    agent,
    project,
    model,
    mock,
    browser: browserForSession(agent, runnerRow),
    callbackUrl: sessionCallbackUrl(runnerRow),
    resume: null,
    titleExamples: await titleExamplesFor(sessionId, task, agent, mock),
  });
  runLifecycle(
    sessionId,
    taskId,
    runnerProvider().make(runnerRow.kind, runnerRow.dockerHost, runnerResources(runnerRow)),
    spec,
  );
  return sessionId;
}

/** Resume a waiting session with the answer.
 *
 *  `answeredBy` (v26): "human" (default, every historical caller) or "system", the automatic
 *  wake-up of a dependency wait (`wait_for_task`). The resume prompt SAYS which: announcing "the
 *  human answered" to a session nobody woke would be a lie in its own conversation, and the agent
 *  would draw false conclusions. */
export async function resumeSession(
  sessionId: string,
  answer: string,
  // `cause` (08/09): WHY the machine wakes it. "system" covered a single case, the dependency
  // wait, and its prompt said so. Serving that text to a session resumed after an update would
  // make it look for a task it never waited for. Default unchanged for existing callers.
  opts: { answeredBy?: "human" | "system"; cause?: "dependency" | "update" | "relaunch" } = {},
): Promise<void> {
  const session = sessionRow(sessionId);
  if (!session) throw new Error("session not found");
  // The blocked-session guard (slice nav/11), placed HERE and not in the caller: resuming a
  // session WRITES into its conversation, and an approval gate awaits a human decision.
  // `answeredBy` says who writes; anything not declaring itself human is refused, by name. See
  // sessions/session-guard.ts.
  assertSessionWritable(sessionId, opts.answeredBy ?? "human");
  // `blocked` resumes through the SAME path as `waiting`: the pause is the same (container
  // destroyed, `sdkSessionId` kept), only what was awaited differs.
  if (session.status !== SESSION_STATUS.waiting && session.status !== SESSION_STATUS.blocked)
    throw new Error(`session is ${session.status}, not waiting`);
  const { task, agent, project } = loadContext(session.taskId);
  // Demo project: seeded inbox questions can be answered (the UI updates) but no session restarts;
  // only the inbox side records the answer (see answerInbox).
  if (project.demo) throw new Error("Demo project: read only, the session is not restarted.");
  if (!session.mock) assertReposReachable(agent, project, effectiveRepoAccess(task, agent));
  const runnerRow = runnerRowOf(session.runnerId);
  if (!runnerRow) throw new Error("runner not found");

  // The mock flag is authoritative from the session row (review #10): a REAL session
  // whose init callback was lost must fail loudly, never resume down the mock path.
  const mock = session.mock;
  if (!mock && !session.sdkSessionId)
    throw new Error("cannot resume: real session has no sdkSessionId (init callback lost)");
  // A waiting session released its container (destroyed in the finally) and no longer counts
  // toward capacity: resuming without rechecking would exceed maxConcurrentSessions if the pump
  // filled the slot meanwhile (review lot4 #2). The failure reopens the inbox question (answerInbox).
  if (
    !mock &&
    runnerProvider().make(runnerRow.kind, runnerRow.dockerHost).kind === RUNNER_KIND.docker
  ) {
    try {
      pickRunnerRow(agent.runnerPreference);
    } catch (err) {
      // The ORIGINAL message, not a replacement (v51). This `catch` used to say "runner full"
      // whatever the cause, true while capacity was the only one. `pickRunnerRow` now also refuses
      // a sleeping machine: calling a closed Mac "full" sends the operator raising a ceiling that
      // is not the problem.
      throw new Error(`${(err as Error).message} — answer kept, try again in a moment`);
    }
  }
  markSessionResuming(sessionId, session.resumeCount + 1);
  publish(sessionId, "status", { status: SESSION_STATUS.starting, resumed: true });

  // The four wake-up texts live in `sessions/resume-prompt.ts` since 10/09: pure, so tested by
  // calling them. Attachments are repeated at wake-up (16/09): the full brief does not go out
  // again on resume, so its attachments section disappeared, and a file attached DURING the pause
  // reached nobody, the live notice being refused on a destroyed container.
  const prompt = resumePrompt({
    ...opts,
    answer,
    attachments: briefAttachmentsSection(taskAttachments(session.taskId)),
  });
  const spec = buildSpec({
    sessionId,
    callbackToken: session.callbackToken,
    task,
    agent,
    project,
    model: session.model,
    mock,
    browser: browserForSession(agent, runnerRow),
    callbackUrl: sessionCallbackUrl(runnerRow),
    resume: { sdkSessionId: session.sdkSessionId ?? "", prompt },
    // Reread on resume as on launch: the brief is rebuilt whole, and a section vanishing at
    // wake-up would take from the agent, mid-work, what it had at the start.
    titleExamples: await titleExamplesFor(sessionId, task, agent, mock),
  });
  runLifecycle(
    sessionId,
    session.taskId,
    runnerProvider().make(runnerRow.kind, runnerRow.dockerHost, runnerResources(runnerRow)),
    spec,
  );
}

/** Human stop: kill the runtime, mark failed, bounce the task to review. */
export async function stopSession(sessionId: string): Promise<void> {
  const session = sessionRow(sessionId);
  if (!session) throw new Error("session not found");
  const reason = "session stopped by the operator";
  // State first, container second (05/09). The order used to be the reverse, which only held
  // because `destroy` was instant (`docker rm -f`, a SIGKILL). Since destruction asks for a CLEAN
  // stop and gives the runtime thirty seconds to push, `docker wait` returns DURING that delay:
  // `runLifecycle` read a still-`running` session, marked it `destroyed` itself and called
  // `settleTaskAfterSession`, and the requested stop came out as "no finding".
  //
  // The status belongs to whoever DECIDED the end, not to the container's exit code. It is written
  // before touching the runtime, and `runLifecycle` does not go over it (terminal guard).
  // Close any dangling open question — an answered-later ghost would hit a dead session (review #3).
  closeSessionInbox(sessionId);
  // `stopped` and the `doing` filter live in the table (`TASK_MOVE.stop`, tasks/lifecycle.ts): the
  // runner PUBLISHES the stop, the state machine decides what it means.
  applyTaskTransition(session.taskId, TASK_MOVE.stop);
  publish(sessionId, "run_error", { message: reason });
  markSessionTerminal(sessionId, SESSION_STATUS.failed, reason, { stopped: true });
  const runnerRow = runnerRowOf(session.runnerId);
  const runner = runnerProvider().make(
    runnerRow?.kind ?? RUNNER_KIND.docker,
    runnerRow?.dockerHost ?? null,
  );
  await runner.destroy({ id: sessionId, runtime: session.runtimeHandle ?? "" }).catch(() => {});
}

// The launcher, wired to the queue. `queue.ts` picks the next task but cannot launch it: the
// reverse would close an import cycle the harness refuses. Every module reaching the queue goes
// through this file, so the wiring is always done before the first pump.
onTaskLaunch(runTask);
