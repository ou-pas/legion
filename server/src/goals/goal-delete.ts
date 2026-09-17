// Deleting a goal: the missing gesture ("delete a goal" spec, interview of 02/09).
//
// Eight goal routes, all `GET` or `POST`, none erased one. The only server code deleting a goal was
// `deleteProject`: removing a trial goal meant destroying the whole project.
//
// One hard, irreversible gesture (D1). The goal, its log (`goal_events`) and all its tasks go for
// good. No archiving: archiving is refused for any non-`done` task (`tasks/routes/`), and an
// abandoned goal leaves `todo`s. Tasks go with it (D2): "if I delete it, I don't care about the
// linked tasks either".
//
// The artifacts folder goes too (D3), and that is the one act no backup recovers: a database copy
// restores rows, never files. A deliberate break with `tasks/artifacts/scope.ts`, which defends the
// opposite for a live task: an artifacts folder is only reachable through a task
// (`/api/tasks/:id/artifacts`), so once the tasks are gone no screen can ever reach it. Keeping it
// would not preserve evidence, only unreadable waste.
//
// Not done yet: D4 says "a live goal is killed first, not refused". Here an `active`/`paused` goal
// is refused with 409 and the gesture to make (kill switch, then delete): a session's stop time
// has never been measured, and guessing it would be worse than two clicks. "Not yet", not
// "forbidden"; see `LIVE_GOAL` below.
//
// Step order matters:
//  · the artifacts folder is erased before the transaction, while the goal → folder link exists;
//  · `goal_events` before `goals`: the `goal_events.goal_id → goals.id` FK has no `ON DELETE`, the
//    reverse throws.
// Runner workspaces and volumes are released by `deleteTask` itself, before it erases the session
// rows (purge.ts), while the ids are still readable. Repeating it here would double the docker
// calls for no extra guarantee.
import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "../projects/fs-acl.js";
import { deleteTask } from "../projects/purge.js";
import { logControlEvent } from "../events/control-log-store.js";
import {
  blockedByAnyOf,
  blockerLinksOf,
  countGoalEvents,
  countInboxMessages,
  countReviewComments,
  countSessionEvents,
  countTaskActivity,
  deleteGoalRow,
  goalRow,
  goalTaskIds,
  goalTaskNames,
  inGoalDeletionTransaction,
  isDemoProject,
  liveSessionsOfTasks,
  projectRow,
  sessionIdsOfTasks,
  taskNamesById,
} from "./goal-delete-store.js";
import { closeWaitsOn } from "../sessions/wait-for-task.js";
import { GOAL_STATUS } from "./goal-status.js";

/** What a deletion would destroy, announced before doing it. Mirrors `ProjectFootprint`
 *  (purge.ts), plus the artifacts folder: the one unrecoverable item, so the one the armed label
 *  must name (D9). */
export interface GoalFootprint {
  tasks: number;
  sessions: number;
  sessionEvents: number;
  inbox: number;
  reviewComments: number;
  activity: number;
  goalEvents: number;
  /** `true` = the `/artifacts/<goalId>` folder exists on disk and will be erased. */
  artifactsDir: boolean;
}

/** A session still working on one of this goal's tasks, named by its task: a session id means
 *  nothing on screen. */
export type GoalLiveSession = { id: string; status: string; taskName: string };

/** A named task: what will be unblocked outside the goal, and what the confirmation announces (D10). */
export type TaskRef = { id: string; name: string };

export type GoalDeletionPreview = {
  footprint: GoalFootprint;
  live: GoalLiveSession[];
  unblocks: TaskRef[];
};

/** The folder shared by all the goal's tasks: `taskRunScope` returns the goal id for each of them
 *  (`tasks/lifecycle.ts`). `null` if the project is gone: nothing to erase, and no guessed path. */
function goalArtifactsDir(goal: { id: string; projectId: string }): string | null {
  const project = projectRow(goal.projectId);
  if (!project) return null;
  return path.join(projectRoot(project.slug, project.fsRoot), "artifacts", goal.id);
}

export function goalFootprint(goalId: string): GoalFootprint {
  const goal = goalRow(goalId);
  const taskIds = goalTaskIds(goalId);
  const sessionIds = sessionIdsOfTasks(taskIds);
  const dir = goal ? goalArtifactsDir(goal) : null;
  return {
    tasks: taskIds.length,
    sessions: sessionIds.length,
    sessionEvents: countSessionEvents(sessionIds),
    inbox: countInboxMessages(taskIds),
    reviewComments: countReviewComments(taskIds),
    activity: countTaskActivity(taskIds),
    goalEvents: countGoalEvents(goalId),
    artifactsDir: dir !== null && fs.existsSync(dir),
  };
}

/** Live sessions on this goal's tasks.
 *
 *  The demo project is exempt, as elsewhere: its sessions are seeded data frozen in realistic
 *  states, and the runner refuses to start anything there. Without it, a demo goal would be
 *  undeletable, protected forever by sessions that do not run (`purge.ts`). */
export function goalLiveSessions(goalId: string): GoalLiveSession[] {
  const goal = goalRow(goalId);
  if (!goal || isDemoProject(goal.projectId)) return [];
  const tasks = goalTaskNames(goalId);
  if (tasks.length === 0) return [];
  const names = new Map(tasks.map((t) => [t.id, t.name]));
  return liveSessionsOfTasks(tasks.map((t) => t.id)).map((s) => ({
    id: s.id,
    status: s.status,
    taskName: names.get(s.taskId) ?? "?",
  }));
}

/** Tasks outside the goal its deletion will unblock (D10).
 *
 *  `deleteTask` releases its dependents in the transaction, and the scheduler tick pumps the queue
 *  within 30 s: deleting a goal can start work elsewhere. That is said before, not after. A task is
 *  only unblocked if all its remaining blockers belong to the goal; one link from elsewhere still
 *  holds it. */
export function goalUnblocks(goalId: string): TaskRef[] {
  const inside = new Set(goalTaskIds(goalId));
  if (inside.size === 0) return [];
  const held = [...new Set(blockedByAnyOf([...inside]).filter((id) => !inside.has(id)))];
  if (held.length === 0) return [];
  const stillHeld = new Set(
    blockerLinksOf(held)
      .filter((r) => !inside.has(r.blockerId))
      .map((r) => r.taskId),
  );
  const freed = held.filter((id) => !stillHeld.has(id));
  if (freed.length === 0) return [];
  return taskNamesById(freed);
}

/** What the goal page shows before arming the button. `null` = unknown goal (404). */
export function goalDeletionPreview(goalId: string): GoalDeletionPreview | null {
  if (!goalRow(goalId)) return null;
  return {
    footprint: goalFootprint(goalId),
    live: goalLiveSessions(goalId),
    unblocks: goalUnblocks(goalId),
  };
}

export type GoalDeletionRefusal = {
  ok: false;
  status: 404 | 409;
  error: string;
  live?: GoalLiveSession[];
};
export type GoalDeletionDone = {
  ok: true;
  deleted: string;
  footprint: GoalFootprint;
  unblocked: TaskRef[];
  /** Inbox entries closed without waking (Q1): for the trace, and for the screen if it wants it. */
  closedWaits: string[];
};
export type GoalDeletionResult = GoalDeletionDone | GoalDeletionRefusal;

/** The refusal for live goals. The one place that must say "not yet" without ever reading as
 *  "forbidden": D4 (kill first, do not refuse) stays the target, for when a session's real stop
 *  time has been measured rather than guessed. */
const LIVE_GOAL = (status: string): string =>
  `this goal is “${status}”: stop it first (the kill switch, in the same action bar), then ` +
  `delete it. Stopping and deleting in a single gesture is NOT SHIPPED YET — the real stop time ` +
  `of a session has never been measured, and guessing it would risk erasing a session that is ` +
  `still writing.`;

/** Deletes a goal, its log, its tasks and what hangs off them. Refusals are returned named with
 *  their HTTP status, never thrown. */
export function deleteGoal(goalId: string): GoalDeletionResult {
  const goal = goalRow(goalId);
  if (!goal) return { ok: false, status: 404, error: "goal not found" };

  // D5, the one exception that survives slicing. `killGoal` deliberately does not interrupt
  // `committing` (interrupting a session pushing its branch is the surest way to lose work): a goal
  // already killed, hence `failed`, hence deletable here, can carry a session still pushing.
  // Without this refusal we would erase the session row of a container that is writing.
  const committing = goalLiveSessions(goalId).filter((s) => s.status === "committing");
  if (committing.length > 0)
    return {
      ok: false,
      status: 409,
      error:
        `a session is still pushing its branch (task “${committing[0]!.taskName}”) — wait for the ` +
        `commit to finish, otherwise its work is lost`,
      live: committing,
    };

  if (goal.status === GOAL_STATUS.active || goal.status === GOAL_STATUS.paused)
    return {
      ok: false,
      status: 409,
      error: LIVE_GOAL(goal.status),
      live: goalLiveSessions(goalId),
    };

  // Read everything before destroying: afterwards nothing links these counts to anything.
  const footprint = goalFootprint(goalId);
  const unblocked = goalUnblocks(goalId);
  const taskIds = goalTaskIds(goalId);
  const dir = goalArtifactsDir(goal);

  // D3: before the transaction, while the goal → folder link exists. Unrecoverable, which is why
  // the armed label names it.
  if (dir && footprint.artifactsDir) fs.rmSync(dir, { recursive: true, force: true });

  let closedWaits: string[] = [];
  inGoalDeletionTransaction(() => {
    // Q1: sleepers are not woken (D6), but nothing may point at a vanished task: their inbox entry
    // is closed, with its trace.
    closedWaits = closeWaitsOn(taskIds);
    // `deleteTask`'s cascade, not a copy: sessions, events, steers, inbox, review comments,
    // activity, blocker links, and releasing dependents.
    for (const id of taskIds) deleteTask(id);
    deleteGoalRow(goalId);
  });

  // D7: "the deletion is traced in the logs too". Neither a project nor a task does it today; the
  // asymmetry is deliberate: a goal takes files with it, they do not.
  logControlEvent("info", "goals", `goal “${goal.name}” deleted (${goal.status})`, {
    goalId: goal.id,
    name: goal.name,
    projectId: goal.projectId,
    status: goal.status,
    ...footprint,
    unblocked: unblocked.map((t) => t.id),
    closedWaits,
  });

  return { ok: true, deleted: goal.name, footprint, unblocked, closedWaits };
}
