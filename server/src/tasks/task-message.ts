// Talking to a task that no longer has a live session.
//
// The need, in the operator's words (03/09): "when a task is done, we should still be able to send
// it a message". The case behind it: an agent returns its report with a "follow-up to track
// separately (out of scope)" section, and there is nobody left to ask for details or to tell "file
// it".
//
// Steering (`sessions/steering.ts`) talks to a running session and refuses elsewhere ("the session
// is over: it no longer listens"). Rightly: there is no runtime to pass it to. The screen draws the
// consequence (`channels/ChannelsPage.tsx`: the field is absent, not greyed) and left the operator
// without recourse.
//
// This module invents no mechanism, which is the point; same posture as `pauseForOperator`, which
// borrows the inbox rail. "Amend the brief then rerun" is already implemented three times:
// pre-review comments (`review/review.ts`), PR conflict resolution (same file), and answering a
// failure diagnosis (`inbox/inbox.ts`). Each adds its block to the brief, queues the task and
// reruns. None was exposed as a generic gesture: that is all this module adds.
//
// Why this reopens a done task, and why that does not bypass the lock. `markTaskStarted` refuses to
// start a `done` task; that lock guards against an accidental launch by a forgotten API call. Here
// the gesture is explicit, and `lifecycle.ts` states it for the brief: amending then rerunning
// between two sessions is legitimate whatever status was reached (a failed `review`, a `done` being
// reopened). A message therefore moves the task back to `todo`, and the rerun picks it up there.
import { RUN_QUEUED, runTask } from "../sessions/runner/manager.js";
import { ACTIVITY_FROM } from "./activity-enums.js";
import { applyTaskTransition, decidedMove, TASK_MOVE, type TaskStatus } from "./lifecycle.js";
import {
  activeSessionsOf,
  findTaskRow,
  isDemoProject,
  recordMessageActivity,
} from "./task-message-store.js";

/** The block's title in the brief. The thread accumulates below it: two successive messages are two
 *  exchanges, not a correction of the first; hence accumulation, where code review replaces its block
 *  (its comments are replayed from the database on each send). */
const MESSAGE_MARKER = "\n\n## Messages from the operator";

/** How much a message may weigh. The whole brief is capped at 20,000 characters by the PATCH route;
 *  a message is an instruction, not an appendix. */
export const TASK_MESSAGE_MAX = 4_000;

export type SendMessageResult =
  /** `sessionId` names the session that just started; `queued` says none started because capacity
   *  was full and the queue will take it. Both are successes: the message is recorded either way,
   *  and the screen must not show them the same. */
  | { ok: true; sessionId: string | null; queued: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string };

const stamp = (): string =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date());

/** Sends a message to a task, and reruns it so the message is read.
 *
 *  A message that reruns nothing has no reader: the brief is only read when a session starts
 *  (`runner/manager.ts` builds it from `description`). Setting it without a rerun would give the
 *  illusion of having spoken, exactly the defect the derived status chip and the settlement notice
 *  fixed elsewhere.
 *
 *  At full capacity the task is queued rather than failing (`enqueueOnFull`), like code review: the
 *  message is recorded, the work waits its turn, and the screen says so. */
export async function sendTaskMessage(taskId: string, rawText: string): Promise<SendMessageResult> {
  const text = rawText.trim();
  if (!text) return { ok: false, status: 400, error: "empty message" };
  if (text.length > TASK_MESSAGE_MAX)
    return {
      ok: false,
      status: 400,
      error: `message too long (${text.length} characters, maximum ${TASK_MESSAGE_MAX}) — a message is an instruction, not an appendix`,
    };

  const task = findTaskRow(taskId);
  if (!task) return { ok: false, status: 404, error: "task not found" };
  if (isDemoProject(task.projectId))
    return {
      ok: false,
      status: 409,
      error: "demo project: read only, no agent starts here",
    };
  if (!task.assigneeAgentId)
    return {
      ok: false,
      status: 409,
      error: "this task has no agent assigned: nobody would read the message",
    };

  // A live session has its own channel, and a better one: steering talks to the running runtime
  // without restarting it. Point there rather than duplicating the path, and above all rather than
  // rewriting the brief under a working agent.
  const live = activeSessionsOf(taskId);
  if (live.length > 0)
    return {
      ok: false,
      status: 409,
      error: `a ${live[0]!.status} session is working on this task: talk to it directly (steering) rather than through the brief`,
    };

  const previousDescription = task.description;
  const previousStatus = task.status;
  const block = `${MESSAGE_MARKER}\n\n### ${stamp()}\n\n${text}\n`;
  const description = previousDescription.includes(MESSAGE_MARKER)
    ? `${previousDescription}\n### ${stamp()}\n\n${text}\n`
    : previousDescription + block;

  applyTaskTransition(taskId, TASK_MOVE.reopen, { description });

  // The message enters the task's feed, not only its brief: the channel re-reads it to show the
  // conversation, and the trace survives a later brief amendment.
  recordMessageActivity(taskId, ACTIVITY_FROM.human, text);

  try {
    const outcome = await runTask(taskId, { enqueueOnFull: true });
    const queued = outcome === RUN_QUEUED;
    return { ok: true, sessionId: queued ? null : outcome, queued };
  } catch (err) {
    // Same net as review: a rerun that cannot happen (preflight, unreachable runner) restores the
    // state. Otherwise the task would sit in `todo` with a message nobody will read, and the operator
    // would believe they had spoken. The message stays in the activity feed: it was written, the
    // rerun failed, and those are distinct facts.
    applyTaskTransition(taskId, decidedMove(previousStatus as TaskStatus), {
      description: previousDescription,
    });
    return { ok: false, status: 409, error: String((err as Error).message ?? err) };
  }
}
