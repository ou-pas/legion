// A task's status when a session really starts.
//
// This file exists for a precise reason (20/08): the update moving a task to `doing` was filtered
// on `status = 'todo'`. Written for the normal case, it did nothing (no error, no trace) for all
// the others. Visible on the board: a task in the later column, whose displayed promise is "no agent
// will take it", with a "doing" chip next to it. And the same lie for a task rerun from `review`,
// which stayed in review while an agent worked.
//
// The rule is simpler than the guard it replaces: if a session starts, the task is in progress.
// What must be protected is not `todo` but `done`: a finished task does not become "doing" again
// through a forgotten API call.
//
// Queries live in `lifecycle-store.ts`; this file only carries the rules: which transition is
// legal, what it writes, what a settlement records.
import type { schema } from "../shared/db.js";
import type { FsOp } from "../projects/fs-acl.js";
import { REPO_CHECKPOINT_EVENT, REPO_PUSH_EVENT } from "../shared/events.js";
import { asBranchType, formatBranch } from "./task-branch.js";
import {
  archiveDoneTaskRows,
  hasActiveSession,
  lastSessionOf,
  logAutomaticSettlementEvent,
  persistBranchIfUnset,
  pushOrFsOpEvents,
  sessionIdsOf,
  siblingBranchOf,
  writeTaskStatus,
} from "./lifecycle-store.js";

/** The write among the fs channel's five operations (`projects/fs-acl.ts`). Typed by `FsOp` rather
 *  than written by hand: `fs_op` also publishes reads, and confusing the two would pass an agent that
 *  only read files for one that delivered. */
const FS_WRITE: FsOp = "write";

/** Statuses from which a launch is legitimate, hence the ones switching to `doing`.
 *
 *  · `todo`   the normal case.
 *  · `later`  later only blocks automatic paths; launching by hand stays allowed, an explicit
 *             gesture. But then the task must leave the column.
 *  · `review` rerun after a failure or a stop ("Run again").
 *  · `doing`  a new attempt on a task whose previous session died: already the right status, the
 *             update is a no-op, which is fine.
 *
 *  `done` is deliberately absent: nothing may bring a finished task back to work. */
export const LAUNCHABLE_STATUSES = ["later", "todo", "doing", "review"] as const;

/** Marks the task as taken. Returns `true` if a row moved; `false` means the task was `done` (or
 *  missing), i.e. a session just started on something that should not have one. The caller can flag
 *  it rather than let it pass, as the original guard did. */
export function markTaskStarted(taskId: string, now = new Date()): boolean {
  return applyTaskTransition(taskId, TASK_MOVE.launch, {}, now);
}

/** The type comes from the column: a status added to the schema without a name below will not
 *  compile. */
export type TaskStatus = (typeof schema.tasks.$inferSelect)["status"];

/** A task's five statuses, named. No status literal left in the code: the key carries the concept,
 *  the value the serialisation, same shape as `SESSION_STATUS` (sessions/session-terminal.ts) and for
 *  the same reason. Renaming a session status cost sixty literals to hunt down; this one will cost
 *  none.
 *
 *  Labels live in the screen's catalogue (`web/src/tasks/text/`), indexed by these values: the server
 *  decides, the screen names. */
export const TASK_STATUS = {
  /** Later: noted on purpose, committed to nobody. Blocks automatic paths (queue, scheduler), never
   *  the human. The only parking spot, and it never moves on its own. */
  later: "later",
  todo: "todo",
  doing: "doing",
  /** The sink of every ending: delivered work, a failure, a stop. The `settled_outcome` notice tells
   *  them apart, not this status. */
  review: "review",
  done: "done",
} as const satisfies Record<string, TaskStatus>;

/** The list, in board column order. `web/src/api/tasks.ts` keeps its own mirror: the package
 *  boundary is not crossed. */
export const TASK_STATUSES = [
  TASK_STATUS.later,
  TASK_STATUS.todo,
  TASK_STATUS.doing,
  TASK_STATUS.review,
  TASK_STATUS.done,
] as const;

/** The only rule constraining a status transition (whatever field triggers it: PATCH `status`, or
 *  the Kanban drag and drop in `task-move.ts`): `later` only connects with `todo`. A
 *  `doing`/`review`/`done` task has a live session, awaits a decision, or is finished; sending it
 *  there would leave in-progress work ownerless, so postponing happens from the queue, never from
 *  started work; and a later task commits to `todo` before going further in the workflow.
 *
 *  Returns an error message (for a 400) or `null` if the transition is free. Shared so the Kanban
 *  move applies exactly the same rule rather than a copy that diverges one day. */
export function statusTransitionError(before: TaskStatus, after: TaskStatus): string | null {
  if (after === "later" && before !== "todo" && before !== "later")
    return `a “${before}” task cannot be saved for later: bring it back to todo first`;
  if (before === "later" && after !== "todo" && after !== "later")
    return "a “later” task commits to todo before going any further";
  return null;
}

/** What automatic settlement recorded. `null` is not one of them: it lives in the column and means
 *  "no notice" (the agent settled itself, or the task was never settled by an automatic path). Web
 *  mirror: `SETTLED_OUTCOMES` (api/tasks.ts). */
export const SETTLED_OUTCOMES = ["delivered", "empty", "failed", "stopped"] as const;
export type SettledOutcome = (typeof SETTLED_OUTCOMES)[number];

/** The four notices, named, so no write site carries a literal. `satisfies` guarantees this object
 *  covers exactly the union: adding a notice to the list without naming it here will not compile. */
export const SETTLED = {
  delivered: "delivered",
  empty: "empty",
  failed: "failed",
  stopped: "stopped",
} as const satisfies Record<SettledOutcome, SettledOutcome>;

/** What a transition also writes, in the same `update` as the status. The list is short and closed
 *  on purpose: columns belonging to the same fact as the status change, not an editing grab bag.
 *  `settledOutcome` is the textbook case (v56): written afterwards, one would have to rediscover
 *  where that `review` came from, precisely what nobody managed from the screen. */
type TaskStatusWrite = Partial<
  Pick<
    typeof schema.tasks.$inferInsert,
    "archived" | "boardOrder" | "description" | "queued" | "settledOutcome"
  >
>;

/** A transition: where it leads, where it may start from, what else it writes.
 *
 *  `from: null` does not mean "no rule": the rule sits at the deciding boundary,
 *  `statusTransitionError` above for the operator, `internal-routes.ts`'s guards for an agent. One
 *  more SQL filter would be a second guard that would end up saying something else. */
type TaskTransition = {
  readonly to: TaskStatus;
  readonly from: readonly TaskStatus[] | null;
  readonly also?: TaskStatusWrite;
};

/** The transition table: the only authority on a task's status (06/09).
 *
 *  Before it the rules all existed, but not in one place: `LAUNCHABLE_STATUSES` said what leads to
 *  `doing`, a `WHERE status = 'doing'` said what leads to `review`, `stopSession`
 *  (sessions/runner/manager.ts) settled on its own path with a comment explaining why it had to run
 *  before the sweep, and six files outside `tasks/` wrote the column directly. A rule living in a
 *  `WHERE` can only be read by re-reading the whole repository, and that is how a task stayed
 *  "doing" forever.
 *
 *  Each line below transcribes a rule that already existed. None is new, none moved a status: the
 *  earlier tests are the contract, and they were not touched. */
export const TASK_MOVE = {
  /** A session really starts. `done` is absent from `LAUNCHABLE_STATUSES`, which is the whole point:
   *  nothing brings a finished task back to work. `queued` drops because a starting session proves a
   *  slot was found; `settledOutcome` because it is the previous ending's notice, and a stale notice
   *  looks like a fact. */
  launch: {
    to: TASK_STATUS.doing,
    from: LAUNCHABLE_STATUSES,
    also: { queued: false, settledOutcome: null },
  },
  /** The session-end sweep settles the task. `from: doing` is the guard that costs nothing when the
   *  agent settled itself: the update then does nothing. The notice arrives through `extra`: it is
   *  computed, not declared. */
  settle: { to: TASK_STATUS.review, from: [TASK_STATUS.doing] },
  /** The operator stops the session. The only path setting `stopped`, and the only one to `review`
   *  not going through `settleTaskAfterSession`: it settles before the session is terminal, so the
   *  following sweep no longer matches. Without it, a requested stop would come out as "no notice",
   *  i.e. like an agent that settled itself. */
  stop: {
    to: TASK_STATUS.review,
    from: [TASK_STATUS.doing],
    also: { settledOutcome: SETTLED.stopped },
  },
  /** A launch left without a container. The parking spot, not the queue, and the `doing` filter is
   *  deliberate: if a human moved the task meanwhile, their gesture wins over ours. */
  stall: { to: TASK_STATUS.later, from: [TASK_STATUS.doing], also: { queued: false } },
  /** The machine will not take this task, and nothing will change on its own (12/09): the missing
   *  image never came back and the operator has nothing to rebuild (`sessions/runner/image-watch.ts`),
   *  or the runner stayed unreachable (Docker down, disk full) for too long
   *  (`infra/runner/unavailability-sweep.ts`). Two causes, one gesture: both sweeps park the same
   *  thing the same way, and two identical lines in this table would suggest two rules.
   *
   *  Same parking as `stall`, another entry door: these tasks never started (they stayed `todo`,
   *  skipped by the queue, `markTaskStarted` never ran), and `stall`, filtered on `doing`, would not
   *  have moved them an inch, silently. */
  park: { to: TASK_STATUS.later, from: [TASK_STATUS.todo], also: { queued: false } },
  /** An agent says `done` without the artifacts its step declares (plan.md §4): the task stays in
   *  review, and the call returns 422. */
  artifactsMissing: { to: TASK_STATUS.review, from: null },
  /** Put the task back to work by rewriting its brief. Four callers each wrote the same
   *  `status: todo` next to their `description`: the sent review, assisted conflict resolution, the
   *  inbox retry, the operator's message. */
  reopen: { to: TASK_STATUS.todo, from: null },
  /** Breakdown finishes itself, in the transaction that just created its slices. */
  finish: { to: TASK_STATUS.done, from: null },
} as const satisfies Record<string, TaskTransition>;

/** The transition whose target is decided elsewhere: the operator moving a card, the agent giving
 *  its verdict, the failed rerun restoring the previous status. No row in the table because it has
 *  no fixed destination, but it goes through the same writer, which is what counts: `status` is
 *  written nowhere else.
 *
 *  `from` serves `completeTask`'s optimistic lock: restate the status read earlier, so a concurrent
 *  gesture is not silently overwritten. */
export const decidedMove = (
  to: TaskStatus,
  from: readonly TaskStatus[] | null = null,
): TaskTransition => ({ to, from });

/** The only writer of a task's status.
 *
 *  Returns `true` if a row moved. `false` is not an error: the transition's `from` did not match (the
 *  task was `done`, already settled, or missing). That is how `markTaskStarted` flags a launch on a
 *  finished task, and how `settle` steps aside for an agent that settled first.
 *
 *  `extra` carries what the caller knows and the table cannot: a settlement's computed notice, a
 *  rerun's rewritten brief, a dropped card's rank. It joins the status in the same `update`, never a
 *  second one. */
export function applyTaskTransition(
  taskId: string,
  move: TaskTransition,
  extra: TaskStatusWrite = {},
  now = new Date(),
): boolean {
  return writeTaskStatus(
    taskId,
    { ...move.also, ...extra, status: move.to, updatedAt: now },
    move.from,
  );
}

/** A run's scope: what identifies the work shared by a standalone task, all the steps of a chain, or
 *  all the rounds of a goal. One definition, because it decides two things that must agree: the
 *  artifacts folder and the git branch. It was written three times (`buildSpec` twice,
 *  `artifactsPath` once); `wait_for_task` re-reads it to tell the woken agent where the awaited work
 *  is. */
export function taskRunScope(task: {
  id: string;
  templateRunId: string | null;
  goalId?: string | null;
}): string {
  return task.templateRunId ?? task.goalId ?? task.id;
}

/** What a task needs to get a branch. Structural, like `taskRunScope`: callers pass a full row, tests
 *  pass what decides. */
type BranchTask = {
  id: string;
  name: string;
  type: string;
  templateRunId: string | null;
  goalId?: string | null;
  externalRef: string | null;
  branch?: string | null;
};

/** The branch a task pushes its work to. An exact mirror of what `buildSpec` sends to the runtime,
 *  which is the point: a wait's wake-up answer names this branch, so it cannot guess it otherwise.
 *
 *  Three sources, in this order.
 *
 *   1. `externalRef.branch`: an existing PR's branch, on a fix task. It belongs to someone else: we
 *      neither rename it nor store it.
 *   2. The `branch` column, when set. The normal case after the first time.
 *   3. A derivation, written right away.
 *
 *  Why it writes, although it used to be pure. A branch name comes from the task name, and a name can
 *  be renamed (`task-edit.ts`). Recomputing on every read would change the branch of a task whose
 *  work is already pushed: the commit stays on the old one, which nobody names any more, and nothing
 *  flags it; exactly the class of silent loss this slice exists to close. Set then re-read, the
 *  function stays deterministic for a given task, the property a wait's wake-up and PR opening
 *  depend on.
 *
 *  A chain and a goal share a branch, as they share their artifacts folder (`taskRunScope`). Their
 *  steps carry different names, so deriving each on its own would make as many branches as steps and
 *  break that sharing. The first step asking sets the run's branch; the next ones (including those a
 *  goal spawns much later) take their siblings'. */
export function taskBranch(task: BranchTask): string {
  if (task.externalRef) {
    try {
      const branch = (JSON.parse(task.externalRef) as { branch?: string }).branch;
      if (branch) return branch;
    } catch {
      // Unreadable externalRef (broken JSON): the derived branch stays right, do not throw here.
    }
  }
  if (task.branch) return task.branch;

  const scope = taskRunScope(task);
  const branch =
    siblingBranch(scope, task.id) ?? formatBranch(asBranchType(task.type), task.name, scope);
  // `updatedAt` is not touched: setting a branch is not a task modification, and the board sorts on
  // it.
  persistBranchIfUnset(task.id, branch);
  return branch;
}

/** The branch already set by a sibling of the same run (chain or goal), if any. A standalone task is
 *  its own scope: no sibling possible, no query. */
function siblingBranch(scope: string, taskId: string): string | null {
  if (scope === taskId) return null;
  return siblingBranchOf(scope);
}

/** Statuses from which a task's settings (title, agent, gate, complexity, priority) stay ours; not
 *  its workflow status (see `LAUNCHABLE_STATUSES` above) nor its brief (see `isBriefEditable` below).
 *  Once `doing`, `review` or `done`, a session saw (or will see) those settings: changing them under
 *  it would make the screen lie about what was entrusted. Both `todo` and `later` are eligible, not
 *  only `later`: the bug this file fixed (see the header) would reappear on `todo` if we wrote
 *  `status === "later"`. */
export const EDITABLE_STATUSES = ["later", "todo"] as const;

/** What a launch allows (`LAUNCHABLE_STATUSES`) is a strict superset of what settings editing allows
 *  (`EDITABLE_STATUSES`): anything still editable must be launchable. The reverse would be absurd (a
 *  launchable task with frozen settings); checked in a test rather than assumed. */
export function isTaskEditable(
  task: { status: string },
  ctx: { hasLiveSession: boolean; demoProject: boolean },
): boolean {
  if (ctx.demoProject) return false; // read-only sandbox (see purge.ts liveSessions)
  if (ctx.hasLiveSession) return false; // a session already received (or holds) these settings
  return (EDITABLE_STATUSES as readonly string[]).includes(task.status);
}

/** The brief (`description`) follows a different, deliberately wider rule, decided in `bd8ce68`:
 *  amending then rerunning between two sessions is legitimate whatever status was reached (a failed
 *  `review`, a `done` being reopened). Only a live session freezes the brief, its container already
 *  left with it. Merging this rule into `isTaskEditable` would break that shipped behaviour, so the
 *  two predicates stay distinct. */
export function isBriefEditable(ctx: { hasLiveSession: boolean }): boolean {
  return !ctx.hasLiveSession;
}

/** Blockers follow the brief's rule, not the settings' (10/09).
 *
 *  A blocker is not a setting entrusted to a session: it is read at launch and decides the next
 *  launch. Freezing it from `doing` protected nothing, and took from the operator the only gesture
 *  that fixes a link set by an agent: `propose_task(blocking: true)` can declare the origin task
 *  blocked by the work it files, even when the reverse is true. Seen on `T6ywbnqS3Y`, in `review`,
 *  blocked by a follow-up task depending on its own merge: the link was wrong, and nothing could undo
 *  it.
 *
 *  What freezes stays a live session: it left with the list, and rewriting it underneath would make
 *  the screen lie about what was launched. */
export function areBlockersEditable(ctx: {
  hasLiveSession: boolean;
  demoProject: boolean;
}): boolean {
  return !ctx.demoProject && !ctx.hasLiveSession;
}

/** What happens to the task when a session stops.
 *
 *  The bug (26/08, `fxHi2IpRXo`): the session ended in success, and the task stayed `doing`. Forever.
 *  No live session behind it, no artifact, no branch, no report, but the board showed "doing" on work
 *  stopped an hour earlier, and nothing ever brought it back to anyone's attention.
 *
 *  The cause: both places settling the task did so only on failure (`if (!succeeded)`,
 *  `if (failed)`). The assumption was that a succeeding agent calls `update_task` and settles itself.
 *  True most of the time, and precisely the kind of assumption that must not carry an invariant: an
 *  agent finishing without calling the tool is not a rare case, it is an agent.
 *
 *  The guard costs nothing when the assumption holds: `from: doing` makes the update a no-op once the
 *  agent did its job.
 *
 *  What must not break, and that is the crux: a stopping session is not a stopping task. An inbox
 *  pause destroys the container and leaves the session `waiting`; it will resume. Settling the task
 *  then would pull it out from under the sleeping agent. Hence the condition: settle only when no
 *  session of this task is active any more. */
export function settleTaskAfterSession(taskId: string): boolean {
  if (hasActiveSession(taskId)) return false;
  // Computed once: the update needs it for the column, the control-plane trace to say why. Two reads
  // of the same notice could have diverged if a session ended in between (unlikely race, but free to
  // close).
  const outcome = settledOutcomeOf(taskId);
  // The notice joins the settlement in the same update (v56): the moment we still know why we
  // settle. It goes through `extra` because it is computed: the table carries rules, not the day's
  // facts.
  const moved = applyTaskTransition(taskId, TASK_MOVE.settle, { settledOutcome: outcome });
  if (moved) logAutomaticSettlement(taskId, outcome);
  return moved;
}

/** Control-plane trace of an automatic settlement that is not a delivery, same family as preflight
 *  refusals (source `preflight`). Until then, a session dying on an API overload or any failure left
 *  no row in `control_events`, only in that session's feed, which had to be reopened task by task to
 *  understand what failed. `delivered` is not traced here (not an incident), nor `stopped` (a
 *  requested stop is never the notice this function produces, see `settledOutcomeOf`). */
function logAutomaticSettlement(taskId: string, outcome: SettledOutcome): void {
  if (outcome !== SETTLED.empty && outcome !== SETTLED.failed) return;
  const last = lastSessionOf(taskId);
  const label =
    outcome === SETTLED.empty
      ? "finished leaving nothing on the branch — no commit pushed, no artifact written"
      : "finished in failure";
  logAutomaticSettlementEvent(taskId, `task ${taskId} moved to review, ${label}`, {
    outcome,
    sessionId: last?.id ?? null,
    endReason: last?.endReason ?? null,
  });
}

/** The notice, taken from the task's latest session.
 *
 *  A `failed` session is a failure, period. A session exiting without error raises the real
 *  question, did it produce anything, because that is the misleading case: the SDK returns a
 *  `result` of subtype `success` even when its text is "API Error: 529 Overloaded". Six attempts
 *  ended that way on 03/09, each billed, each settled as "ready to review".
 *
 *  `stopped` is never returned here: an operator-requested stop settles the task on its own path
 *  (`stopSession`, sessions/runner/manager.ts), and `settle`'s `from: doing` keeps the sweep from
 *  passing behind it. The value is in the union because the column carries it, not because this
 *  function produces it. */
function settledOutcomeOf(taskId: string): SettledOutcome {
  const last = lastSessionOf(taskId);
  if (!last) return SETTLED.empty; // settled without any session ever running
  if (last.status === "failed") return SETTLED.failed;
  return taskProducedSomething(taskId) ? SETTLED.delivered : SETTLED.empty;
}

/** Did the task produce anything durable?
 *
 *  Signals, all in the database (no disk I/O, this runs at every session end):
 *
 *   · `repo_push` with `changes > 0`: code went to the branch. `changes: 0` is the explicit "nothing
 *     to deliver" report (runner-payload/session-runner.mjs), not a missing trace;
 *   · `repo_checkpoint`: the periodic net committed and pushed (14/09). It was missing, and its
 *     absence settled as "empty" sessions that had delivered: a failing final push emits no
 *     `repo_push`, so a session whose last push was rejected lost at once the trace of everything
 *     its checkpoints had already put on the branch. Measured on `P2BYzKpcD1`: 99 tool calls, two
 *     checkpoints pushed (`69a5174`, `48b8c63`, both on origin), final push rejected as
 *     non-fast-forward, verdict "produced nothing";
 *   · `fs_op` with `op: "write"`: an artifact or file was written through the fs channel. That
 *     catches read-only tasks: they never push anything by construction, and their deliverable is
 *     an artifact. Without it every successful audit would be recorded "empty", noise that teaches
 *     people to ignore the notice.
 *
 *  `fs_op` also covers reads, hence the filter on `op`: an agent that only read files produced
 *  nothing. */
function taskProducedSomething(taskId: string): boolean {
  const sessionIds = sessionIdsOf(taskId);
  if (sessionIds.length === 0) return false;
  const rows = pushOrFsOpEvents(sessionIds);
  return rows.some((r) => {
    // An unreadable payload is not a delivery, but must not fail a settlement either: ignore it, as
    // `taskBranch` ignores a broken `externalRef`.
    let payload: { changes?: unknown; op?: unknown };
    try {
      payload = JSON.parse(r.payload) as { changes?: unknown; op?: unknown };
    } catch {
      return false;
    }
    if (r.type === REPO_PUSH_EVENT)
      return typeof payload.changes === "number" && payload.changes > 0;
    // A checkpoint has no count to show: emitting it is the proof, its emitter stays silent when
    // HEAD did not move or the push failed.
    if (r.type === REPO_CHECKPOINT_EVENT) return true;
    return payload.op === FS_WRITE;
  });
}

/** Bulk archive: all of a project's unarchived `done` tasks, in one gesture (5b). Returns the number
 *  of rows touched, zero included: "nothing to archive" is not an error.
 *
 *  Here rather than in a separate module (06/09): it is the same rule as refusing to archive an
 *  unfinished task (`task-patch.ts`), and two places saying "only a `done` task is archived" end up
 *  saying one and a half. */
export function archiveDoneTasks(projectId: string): number {
  return archiveDoneTaskRows(projectId, TASK_STATUS.done);
}
