// The task mapper: computed fields need one place for serialisation. `editable`/`briefEditable` were
// the first to need it (plan "Edit an uncommitted task", §2.3): the client never re-derives the
// rule. A precedent not to extend: `allowedMove()` (TaskPage.tsx) already copies it for status
// transitions, and the two copies will diverge one day.
//
// `briefEditable` covers the brief's text, and since 07/09 no longer dropping an attachment
// (`tasks/routes/artifacts.ts`). They live differently: the brief is read at session start and
// replaced at the next one, so amending it while a session runs would make the screen lie about the
// instruction received. An attachment is added and announced: the file is readable right away
// through `fs_read`, and a steer tells the session it is there. Only removing an attachment still
// follows `briefEditable`, for the opposite reason: the session holds its path.
import type { schema } from "../shared/db.js";
import { LIVE } from "../projects/purge.js";
import { isBriefEditable, isTaskEditable } from "./lifecycle.js";
import { blockersByTask, type BlockerRef } from "./blockers.js";
import { hasLiveSession, isDemoProject } from "./task-serialize-store.js";
import { openWaitsByTask } from "../sessions/wait-for-task.js";
import { imageWaitOfTask } from "../sessions/runner/image-wait.js";
import { runnerWaitForTask } from "../infra/runner/unavailability.js";

type TaskRow = typeof schema.tasks.$inferSelect;
type SessionRow = typeof schema.sessions.$inferSelect;

/** v26: what the task page must spell out when its session sleeps on a dependency
 *  (`wait_for_task`): which task, in which state, since when (`since`, ms timestamp). An invisible
 *  wait would be worse than none: the task looks in progress, the session looks alive, and nothing
 *  moves. Computed server-side, like `editable`; the client does not re-derive the rule. */
export type TaskWaitDto = {
  inboxId: string;
  waitForTaskId: string;
  waitForTaskName: string;
  waitForTaskStatus: string | null;
  since: number;
};

/** 12/09: why this task does not start when the machine lacks the image. The board said "queued",
 *  i.e. that a machine would take it, which was false; the chip lies less than silence. Two states,
 *  and the second applies to every task waiting on the same image: the same rebuild unblocks them
 *  all. */
export type TaskImageWaitDto = {
  image: string;
  runnerName: string;
  rebuilding: boolean;
};

/** 12/09: what the board must spell out when the queue skips this task because its machine is
 *  unavailable (Docker down, disk full). Otherwise the "queued" chip lies: it promises a slot that
 *  does not free up, unlike full capacity. `infra/runner/unavailability.ts` holds the fact, in
 *  memory, per machine. Next to `TaskImageWaitDto` and not merged with it: a missing image has a
 *  gesture to offer (rebuild), these two failures have none from Legion. */
export type TaskRunnerWaitDto = {
  runnerId: string;
  runnerName: string;
  reason: "docker-down" | "disk-full";
  message: string;
  since: number;
};

export type TaskDto = TaskRow & {
  editable: boolean;
  briefEditable: boolean;
  waitingFor: TaskWaitDto | null;
  imageWait: TaskImageWaitDto | null;
  /** v44: the tasks still holding this one, named, from `task_blockers`: the board says how many and
   *  which (behaviour 8). Empty = free. */
  blockedBy: BlockerRef[];
  /** `null` while the task is not held by an unavailable machine; see `TaskRunnerWaitDto`. */
  runnerWait: TaskRunnerWaitDto | null;
};

const isLive = (status: string): boolean => (LIVE as readonly string[]).includes(status);

/** The image wait, and only while the task is queued. A wait lives in memory and keeps its ids until
 *  the probe lifts it: without this filter, a task a human moved meanwhile would still carry the
 *  chip of a queue it left. */
function imageWaitOf(task: { id: string; status: string }): TaskImageWaitDto | null {
  if (task.status !== "todo") return null;
  const wait = imageWaitOfTask(task.id);
  if (!wait) return null;
  return { image: wait.image, runnerName: wait.runnerName, rebuilding: wait.rebuilding };
}

/** `runnerWaitForTask` returns a `Date` (internal fact); the DTO returns a ms timestamp, like
 *  `TaskWaitDto.since` above. A `Date` already serialises to an ISO string elsewhere in this file
 *  (the task columns), and a second format for the same concept would make readers guess which
 *  applies where. */
function runnerWaitOf(taskId: string): TaskRunnerWaitDto | null {
  const wait = runnerWaitForTask(taskId);
  if (!wait) return null;
  const { since, ...rest } = wait;
  return { ...rest, since: since.getTime() };
}

/** Serialises a batch of tasks in one pass: the engine shared by `serializeTaskSummaries` (the list
 *  route) and any caller truly needing a batch's full records (e.g. `goals.ts`, serialising one
 *  goal's tasks, never the board's 108). Sessions are loaded once and demo projects can be too;
 *  asking "live session?" per task (like `taskLiveSessions`, designed for one) would make O(n)
 *  queries on a board showing dozens. */
export function serializeTasks(
  rows: TaskRow[],
  sessions: SessionRow[],
  demoProjectIds: Set<string>,
): TaskDto[] {
  const liveTaskIds = new Set<string>();
  for (const s of sessions) if (isLive(s.status)) liveTaskIds.add(s.taskId);
  // One query for the whole batch (open waits are a handful), not one per board row: same reason as
  // the `sessions` parameter above.
  const waits = openWaitsByTask();
  const blockers = blockersByTask(); // same: the whole table in one query, not one per card
  return rows.map((task) => {
    const demoProject = demoProjectIds.has(task.projectId);
    // A demo project never has a live session, whatever `sessions` says; same exception as
    // `purge.ts` (`liveSessions`/`taskLiveSessions`): its sessions are seeded data.
    const hasLiveSession = !demoProject && liveTaskIds.has(task.id);
    return {
      ...task,
      editable: isTaskEditable(task, { hasLiveSession, demoProject }),
      briefEditable: isBriefEditable({ hasLiveSession }),
      waitingFor: waits.get(task.id) ?? null,
      imageWait: imageWaitOf(task),
      blockedBy: blockers.get(task.id) ?? [],
      runnerWait: runnerWaitOf(task.id),
    };
  });
}

/** Measured on 02/09: 108 full tasks (`description` up to 20,000 characters, `criteria` as JSON) to
 *  paint board cards showing three chips, ~460 KB reloaded by the safety net every 60 s
 *  (`queries.ts`), per viewer. `GET /api/tasks` now returns this: what a card shows (id, name,
 *  status, agent, branch, counters, priority, type…), never the brief or criteria. The detail
 *  (`GET /api/tasks/:id`) still carries them in full; the task page asks for it separately (see
 *  `TaskPage.tsx`, `taskQuery`). */
export type TaskSummaryDto = Omit<TaskDto, "description" | "criteria">;

/** The list route: `serializeTasks` minus the two heavy fields. Derived rather than rewritten: the
 *  `editable`/`briefEditable`/`waitingFor`/`blockedBy` logic lives once, in `serializeTasks`. */
export function serializeTaskSummaries(
  rows: TaskRow[],
  sessions: SessionRow[],
  demoProjectIds: Set<string>,
): TaskSummaryDto[] {
  return serializeTasks(rows, sessions, demoProjectIds).map((task) => {
    const { description: _description, criteria: _criteria, ...summary } = task;
    return summary;
  });
}

/** Serialises one task, full record (responses of `POST`/`PATCH /api/tasks/:id` and
 *  `GET /api/tasks/:id`). Two more queries than `serializeTasks`, acceptable here: the route never
 *  returns more than one row. */
export function serializeTask(row: TaskRow): TaskDto {
  const demoProject = isDemoProject(row.projectId);
  const liveSession = !demoProject && hasLiveSession(row.id, isLive);
  return {
    ...row,
    editable: isTaskEditable(row, { hasLiveSession: liveSession, demoProject }),
    briefEditable: isBriefEditable({ hasLiveSession: liveSession }),
    waitingFor: openWaitsByTask([row.id]).get(row.id) ?? null,
    imageWait: imageWaitOf(row),
    blockedBy: blockersByTask([row.id]).get(row.id) ?? [],
    runnerWait: runnerWaitOf(row.id),
  };
}
