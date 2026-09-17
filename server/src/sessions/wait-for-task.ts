// `wait_for_task` (23/08, operator's request): a session SLEEPS on a dependency and wakes on its own
// when it is lifted.
//
// The gap. An agent hitting "I need task X's API before doing my part" had two ways out: finish
// leaving half its work, or bother the human with a question that is not one ("tell me when X is
// ready"). The case seen that day: the front agent on `propose_task` could have proposed the server
// task, waited for its merge, and resumed on the web side with its context intact.
//
// Nothing reinvented. The inbox pause already does the hard part: `waiting` = container destroyed
// (zero cost), `sdkSessionId` kept, resume with the branch fetched, so a resume after X's merge sees
// X's work. This module only generalises the TRIGGER: the inbox entry carries one more field
// (`waitForTaskId`, v26). No new session status, no parallel queue, no dedicated scheduler.
//
// The entry stays an inbox entry, which is a guardrail: the human can always answer INSTEAD of the
// system, waking it earlier with their own text or saying to give up. The automatic wake-up is one
// more responder on the same channel; the first to answer wins, the other finds the entry closed.
//
// Refusals are named, never silent waits:
//  · cycle (A waits on B waiting on A, directly or through a chain) → 409 with the path spelled out;
//  · target already `done` → IMMEDIATE answer, no pause for nothing;
//  · target deleted during the wait → wake-up "task X was deleted", the agent decides;
//  · one active wait per session;
//  · target outside the session's project → not found (a session learns nothing of another
//    project).
import { nanoid } from "nanoid";
import { type schema } from "../shared/db.js";
import { logControlEvent } from "../events/control-log-store.js";
import {
  allTaskBlockers,
  closeInboxMessage,
  insertSystemNote,
  openWaitOfSession,
  openWaitRows,
  openWaitsOnTask,
  openWaitsOnTasks,
  sessionRow,
  taskActivityOf,
  taskRow,
  taskRowsByIds,
} from "./wait-for-task-store.js";
import { publish } from "../shared/events.js";
import { addNotice, answerInbox, createInboxMessage } from "../inbox/inbox.js";
import { taskBranch, taskRunScope } from "../tasks/lifecycle.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { ACTIVITY_FROM } from "../tasks/activity-enums.js";

type TaskRow = typeof schema.tasks.$inferSelect;

/** Bounded: this note comes from an agent and shows in the human attention queue. */
export const WAIT_NOTE_MAX = 600;
/** Bounded too: the awaited task's report is INJECTED into the woken agent's conversation. A 40 kB
 *  report would eat its context window at resume. */
export const WAIT_RESULT_NOTE_MAX = 2_000;

/** States in which a session can still fall asleep. A finished (or committing) session does not
 *  wait: it has no turn left to play at wake-up. */
const PAUSABLE = ["starting", "running"] as const;

export type WaitForTaskResult =
  /** The session is paused, the inbox entry waits (system OR human). */
  | {
      ok: true;
      waiting: true;
      inboxId: string;
      target: { id: string; name: string; status: string };
    }
  /** Nothing to wait for: the target is already done, its result is returned at once. */
  | { ok: true; waiting: false; result: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

// The wait graph. Two kinds of edges, because there are two ways for a task to wait on another, and
// a deadlock is easily built by mixing them:
//  · "wait": a session running on A sleeps on B (`inbox.waitForTaskId`);
//  · "chain": B is blocked by A (`task_blockers`, one link per blocker since v44). B will NOT start
//    until A is done, so if A's session waits on B, nobody moves.
type WaitEdge = { to: string; why: "wait" | "chain" };

function waitGraph(): Map<string, WaitEdge[]> {
  const graph = new Map<string, WaitEdge[]>();
  const add = (from: string, edge: WaitEdge) => {
    const list = graph.get(from);
    if (list) list.push(edge);
    else graph.set(from, [edge]);
  };

  const waits = openWaitRows();
  for (const w of waits) if (w.waitForTaskId) add(w.taskId, { to: w.waitForTaskId, why: "wait" });

  for (const l of allTaskBlockers()) add(l.taskId, { to: l.blockerId, why: "chain" });

  return graph;
}

/** The path leading back from `targetId` to `fromId`, or `null`. Returning the PATH (not a boolean)
 *  is what lets the refusal be named: "A waits on B waiting on A" can be fixed, "circular dependency"
 *  cannot. */
export function findWaitCycle(
  fromTaskId: string,
  targetTaskId: string,
): { taskId: string; why: WaitEdge["why"] }[] | null {
  if (fromTaskId === targetTaskId) return [];
  const graph = waitGraph();
  const seen = new Set<string>([targetTaskId]);
  const stack: { taskId: string; path: { taskId: string; why: WaitEdge["why"] }[] }[] = [
    { taskId: targetTaskId, path: [] },
  ];
  while (stack.length > 0) {
    const { taskId, path } = stack.pop()!;
    for (const edge of graph.get(taskId) ?? []) {
      const step = [...path, { taskId: edge.to, why: edge.why }];
      if (edge.to === fromTaskId) return step;
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      stack.push({ taskId: edge.to, path: step });
    }
  }
  return null;
}

const taskName = (id: string): string => taskRow(id)?.name ?? "unknown task";

/** A line in the WAITING task's activity thread: the trace reread months later on the task page.
 *  Without it the history would show a session stopping and restarting for no reason. `from:
 *  ACTIVITY_FROM.system`: neither agent nor human wrote it. */
function noteOnTask(taskId: string, body: string): void {
  insertSystemNote(nanoid(10), taskId, body, new Date());
}

/** Shortened name for the inbox's BOUNDED fields (`impact`, 400 characters): a chain step name is
 *  often over 100 characters and would cut the sentence in half. */
const short = (name: string): string => (name.length > 60 ? `${name.slice(0, 59)}…` : name);

// The awaited task's result: THE useful content of the wake-up. A session restarting on "task X is
// done" and nothing else goes back to exploring; this text gives it the three things it cannot guess:
// where the work was pushed, where the artifacts are, and what the previous agent said.

/** The last agent report on this task (`task_activity`), bounded. */
function lastReport(taskId: string): string | null {
  const notes = taskActivityOf(taskId).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const last = notes.filter((n) => n.from === ACTIVITY_FROM.agent).pop() ?? notes.pop();
  return last?.body?.trim() ? last.body.trim().slice(0, WAIT_RESULT_NOTE_MAX) : null;
}

/** What a FINISHED task leaves behind: branch, PRs, artifacts, report. */
export function describeTaskOutcome(task: TaskRow): string {
  let prs: string[] = [];
  try {
    prs = (JSON.parse(task.prUrls) as { url?: string }[])
      .map((p) => p.url)
      .filter((u): u is string => !!u);
  } catch {
    prs = []; // damaged prUrls: missing PRs must not break a wake-up
  }
  const report = lastReport(task.id);
  return [
    `Task “${task.name}” (${task.id}) — status: ${task.status}.`,
    `Branch: ${taskBranch(task)} (your repo has just been fetched: if its work is merged, it is in there).`,
    prs.length ? `PR: ${prs.join(", ")}` : null,
    `Artifacts: /artifacts/${taskRunScope(task)}`,
    report ? `Agent's last report:\n<report>\n${report}\n</report>` : "No report filed.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type WakeReason = typeof TASK_STATUS.done | "deleted";

/** The text sent back into the sleeping agent's conversation. It SAYS why it wakes: a resume without
 *  a reason is exactly the defect this feature exists to avoid. */
export function wakeText(target: TaskRow | null, targetId: string, reason: WakeReason): string {
  if (reason === "deleted" || !target)
    return (
      `The task you were waiting for (${targetId}${target ? ` — “${target.name}”` : ""}) has been deleted: ` +
      `it will never be finished, and nobody will do it for you. The rest is yours to decide — ` +
      `do without it, do it differently, or stop and explain why in your report.`
    );
  return (
    `The task you were waiting for is done. Here is its result.\n\n${describeTaskOutcome(target)}\n\n` +
    `Pick your work up from there.`
  );
}

// Setting the wait.

/** What prevents a session from sleeping on a task, or `null`. Each refusal NAMES its cause: a bare
 *  409 would send an agent retrying identically. */
function waitRefusal(
  session: { id: string; status: string },
  origin: TaskRow,
  target: TaskRow,
): WaitForTaskResult | null {
  if (target.id === origin.id)
    return { ok: false, status: 409, error: "a task cannot wait on itself" };

  // One active wait per session: otherwise a session could sleep on three tasks and restart at the
  // first wake-up, the other two left as dead entries.
  const already = openWaitOfSession(session.id);
  if (already)
    return {
      ok: false,
      status: 409,
      error: `this session is already waiting on task “${taskName(already.waitForTaskId!)}” (${already.waitForTaskId}) — one wait at a time`,
    };

  // Cycle: a NAMED refusal at request time, never a silent deadlock to hunt down.
  const cycle = findWaitCycle(origin.id, target.id);
  if (cycle)
    return {
      ok: false,
      status: 409,
      error:
        `circular dependency refused: “${origin.name}” would wait on “${target.name}”, ` +
        `which already waits on “${origin.name}” — chain: ${origin.name} → ${target.name}` +
        cycle.map((s) => ` →(${s.why}) ${taskName(s.taskId)}`).join("") +
        `. Finish one of the two first, or cut the work differently.`,
    };

  // A session with no turn left does not sleep: it would wake on nothing.
  if (!(PAUSABLE as readonly string[]).includes(session.status))
    return {
      ok: false,
      status: 409,
      error: `session “${session.status}”: it is no longer in a state to start waiting`,
    };
  return null;
}

/** Falling asleep itself: the inbox entry holding the session, the trace, the note on the waiting
 *  task and the log line. Nothing is decided here anymore; `waitRefusal` settled it. */
function fallAsleepOn(
  sessionId: string,
  origin: TaskRow,
  target: TaskRow,
  note: string | null,
): { inboxId: string } {
  const engaged =
    target.status === TASK_STATUS.later
      ? " Careful: this task is in Later — it is committed to nobody and will only start if a human runs it."
      : "";
  const created = createInboxMessage(sessionId, {
    kind: "text",
    body:
      `I am waiting on task “${target.name}” (${target.id}) before going on.` +
      (note ? `\n\nWhy: ${note}` : "") +
      `\n\nI start again ALL BY MYSELF when it moves to “done”.${engaged}`,
    evidence:
      `Task awaited: “${target.name}” (${target.id}), current status “${target.status}”` +
      (target.assigneeAgentId ? "" : ", no agent assigned") +
      `.\nTask waiting: “${origin.name}” (${origin.id}).`,
    // `impact` is truncated at 400 characters by createInboxMessage: the target name is shortened
    // ON PURPOSE (chain steps have long names that easily exceed 100 characters), otherwise the
    // sentence would be cut in the middle.
    impact:
      `Session paused (container destroyed, zero cost), context kept. It will wake up on its ` +
      `own when “${short(target.name)}” is done. You can answer in place of the system: your ` +
      `text is passed to the agent as is, and wakes it right away.`,
    waitForTaskId: target.id,
  });

  // Trace: WHO waits on WHAT, and since when. The inbox entry's `createdAt` starts the displayed
  // clock ("waiting on task X for N min"), no extra clock needed.
  publish(sessionId, "dependency_wait", {
    inboxId: created.id,
    waitForTaskId: target.id,
    taskName: target.name,
    note,
  });
  noteOnTask(
    origin.id,
    `Waiting on task “${target.name}” (${target.id}).${note ? ` ${note}` : ""}`,
  );
  logControlEvent(
    "info",
    "wait",
    `session ${sessionId} goes to sleep waiting on task ${target.id}`,
    {
      sessionId,
      taskId: origin.id,
      waitForTaskId: target.id,
      inboxId: created.id,
    },
  );
  return { inboxId: created.id };
}

export function requestWaitForTask(
  sessionId: string,
  input: { taskId: string; note?: string },
): WaitForTaskResult {
  const session = sessionRow(sessionId);
  if (!session) return { ok: false, status: 404, error: "session not found" };
  const origin = taskRow(session.taskId);
  if (!origin) return { ok: false, status: 404, error: "origin task not found" };

  const targetId = input.taskId?.trim();
  if (!targetId) return { ok: false, status: 400, error: "empty taskId" };

  const target = taskRow(targetId);
  // Project boundary: a session must learn nothing about another project, not even that a task
  // exists. Same refusal in both cases, on purpose.
  if (!target || target.projectId !== origin.projectId)
    return { ok: false, status: 404, error: `task “${targetId}” not found in this project` };

  // Already done → immediate answer. No pause for nothing: destroying a container and starting
  // another to learn something already true costs a minute and a context.
  if (target.status === TASK_STATUS.done)
    return {
      ok: true,
      waiting: false,
      result: `Nothing to wait for: this task is ALREADY done.\n\n${describeTaskOutcome(target)}`,
    };

  const refusal = waitRefusal(session, origin, target);
  if (refusal) return refusal;

  const note = input.note?.trim().slice(0, WAIT_NOTE_MAX) || null;
  const { inboxId } = fallAsleepOn(sessionId, origin, target, note);
  return {
    ok: true,
    waiting: true,
    inboxId,
    target: { id: target.id, name: target.name, status: target.status },
  };
}

// Lifting the wait.

export type WakeOutcome = { inboxId: string; sessionId: string; woken: boolean; error?: string };

/** Wakes every session waiting on THIS task. Called by `onTaskDone` (the task is done) and by task
 *  deletion (the target disappears).
 *
 *  Never throws: a failed wake-up (runner full, unreachable repo) leaves the inbox entry OPEN (the
 *  human can answer by hand) and says so in the trace AND in notices. A task must not fail to go
 *  `done` because a sleeper could not restart. */
export async function wakeWaitersOf(
  targetTaskId: string,
  reason: WakeReason = TASK_STATUS.done,
): Promise<WakeOutcome[]> {
  const waiters = openWaitsOnTask(targetTaskId);
  if (waiters.length === 0) return [];

  const target = taskRow(targetTaskId) ?? null;
  const text = wakeText(target, targetTaskId, reason);
  const outcomes: WakeOutcome[] = [];

  for (const waiter of waiters) {
    // The trace BEFORE the resume: if the restart fails, we still know why it was attempted. A
    // session never wakes without its trace saying why.
    publish(waiter.sessionId, "dependency_resolved", {
      inboxId: waiter.id,
      waitForTaskId: targetTaskId,
      reason,
    });
    try {
      await answerInbox(waiter.id, { text }, { answeredBy: "system" });
      noteOnTask(
        waiter.taskId,
        reason === TASK_STATUS.done
          ? `Automatic wake-up: the awaited task “${target?.name ?? targetTaskId}” is done.`
          : `Automatic wake-up: the awaited task (${targetTaskId}) has been deleted.`,
      );
      logControlEvent(
        "info",
        "wait",
        `session ${waiter.sessionId} woken up (${reason}) by task ${targetTaskId}`,
        {
          sessionId: waiter.sessionId,
          waitForTaskId: targetTaskId,
          inboxId: waiter.id,
          reason,
        },
      );
      outcomes.push({ inboxId: waiter.id, sessionId: waiter.sessionId, woken: true });
    } catch (err) {
      const detail = String((err as Error)?.message ?? err).slice(0, 300);
      // `answerInbox` reopened the entry: it stays answerable by hand, which IS the escape hatch.
      // Someone still has to know, hence the notice, not only a log.
      logControlEvent("error", "wait", `waking session ${waiter.sessionId} failed: ${detail}`, {
        sessionId: waiter.sessionId,
        waitForTaskId: targetTaskId,
        inboxId: waiter.id,
        reason,
      });
      addNotice(
        `Automatic wake-up impossible: a session is waiting on “${target?.name ?? targetTaskId}” and could ` +
          `not restart (${detail}). Its question stayed open in the Inbox — answer it to start it again.`,
        "wait_failed",
      );
      publish(waiter.sessionId, "run_warning", {
        message: `automatic wake-up failed: ${detail}`,
      });
      outcomes.push({
        inboxId: waiter.id,
        sessionId: waiter.sessionId,
        woken: false,
        error: detail,
      });
    }
  }
  return outcomes;
}

/** Close without waking: `wakeWaitersOf`'s counterpart when the awaited tasks disappear with their
 *  goal ("delete a goal" spec, D6 + amendment of 03/09 on Q1).
 *
 *  Waking is set aside where task deletion calls it (`tasks/routes.ts`): deleting a goal says its
 *  work no longer counts, and restarting a session to tell it about the disappearance would start a
 *  container for nothing. What is still owed is that nothing points to a task that no longer
 *  exists: the inbox entry is closed, with its trace (note on the waiting task, note in the session
 *  stream, control event), never a silent disappearance, same pattern as `expireStaleDiagnostics`.
 *
 *  Named and accepted consequence (D6): the sleeping session stays `waiting` without a responder.
 *  The human restarts it if its work still makes sense; the note on its task says so plainly.
 *
 *  Sleepers leaving THEMSELVES (their task is in the deleted batch) are ignored: the cascade erases
 *  their entry right after, nobody to warn. */
export function closeWaitsOn(deletedTaskIds: string[]): string[] {
  // `inArray` on an empty list produces invalid SQL: nothing to ask, nothing to close.
  if (deletedTaskIds.length === 0) return [];
  const disappearing = new Set(deletedTaskIds);
  const waiters = openWaitsOnTasks(deletedTaskIds).filter((w) => !disappearing.has(w.taskId));
  for (const w of waiters) {
    closeInboxMessage(w.id);
    noteOnTask(
      w.taskId,
      `The awaited task (${w.waitForTaskId}) was deleted along with its goal: the question was removed ` +
        `from the inbox. The session is NOT restarted — pick it up yourself if its work still makes sense.`,
    );
    publish(w.sessionId, "inbox_note", {
      body: "wait closed: the awaited task went away with its goal",
    });
    logControlEvent(
      "info",
      "wait",
      `wait of session ${w.sessionId} closed without a wake-up: task ${w.waitForTaskId} goes with its goal`,
      { sessionId: w.sessionId, taskId: w.taskId, waitForTaskId: w.waitForTaskId, inboxId: w.id },
    );
  }
  return waiters.map((w) => w.id);
}

/** Open waits keyed by WAITING task (not target), for serialising a batch of tasks
 *  (`task-serialize.ts`) without one query per board row. */
export function openWaitsByTask(taskIds?: string[]): Map<
  string,
  {
    inboxId: string;
    waitForTaskId: string;
    waitForTaskName: string;
    waitForTaskStatus: string | null;
    since: number;
  }
> {
  const rows = openWaitRows().filter((r) => !taskIds || taskIds.includes(r.taskId));
  const targets = taskRowsByIds(rows.map((r) => r.waitForTaskId!));
  const byId = new Map(targets.map((t) => [t.id, t]));
  const out = new Map<
    string,
    {
      inboxId: string;
      waitForTaskId: string;
      waitForTaskName: string;
      waitForTaskStatus: string | null;
      since: number;
    }
  >();
  for (const r of rows) {
    const target = byId.get(r.waitForTaskId!);
    out.set(r.taskId, {
      inboxId: r.id,
      waitForTaskId: r.waitForTaskId!,
      // Target gone without a wake-up (database repaired by hand, edge case): SAY so rather than show
      // a bare id nobody can relate to anything.
      waitForTaskName: target?.name ?? "task deleted",
      waitForTaskStatus: target?.status ?? null,
      since: r.createdAt.getTime(),
    });
  }
  return out;
}
