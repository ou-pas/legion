// Deciding on a verified forge event (webhooks batch, 03/09): which task, and does it move. In
// `review/` rather than `integrations/`, following `open-pr.ts`: composing tasks + integrations +
// notifications is this context's job; integrations stays a leaf that does not know what a task is.
//
// The webhook is a doorbell, never a source of truth. The payload, even signed, only identifies
// candidate tasks (PR URL → prUrls). The decision re-reads the real state through `mergeStatesOf`:
// a task only becomes done if the forge says all its PRs are merged, so a payload forged with a
// stolen secret can at worst trigger a re-read. The order is the rate protection: filter the
// payload (free), match in SQLite (free), only then read the forge, so a public route cannot burn
// the project's forge token.
import { nanoid } from "nanoid";
import { completeTask } from "../tasks/complete.js";
import { NOTIF_EVENT, notifyOut } from "../notifications/notify.js";
import { mergeStatesOf } from "../integrations/forge-access.js";
import type { ForgeEvent } from "../integrations/inbound-webhooks.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";
import { ACTIVITY_FROM } from "../tasks/activity-enums.js";
import { publish } from "../shared/events.js";
import { listTaskSessions } from "../sessions/task-events.js";
import { ACTIVE_STATUSES } from "../sessions/session-terminal.js";
import { logControlEvent } from "../events/control-log-store.js";
import {
  controlEventsMentioning,
  insertTaskActivity,
  taskActivityOf,
  tasksInReview,
} from "./merge-events-store.js";

/** The merged-PR count carried by the last `merge-partial` event traced for this task, or `null` if
 *  there never was one. A multi-repository task gets one webhook per merged PR, plus comment and
 *  update webhooks that change nothing about the merge state; logging each would drown the control
 *  log (rotated at 5,000 rows) in identical lines. The rule: only write if the count moved since
 *  this task's last trace, so two webhooks returning the same 1/2 write once.
 *
 *  The `LIKE` on the message is a coarse SQL filter (the task id is a nanoid; a substring false
 *  positive on another id containing it is possible); exactness comes afterwards from strict
 *  equality on `taskId` in the parsed payload. No dedicated index: for a single operator, a
 *  5,000-row table at worst filters in memory with nothing for `EXPLAIN` to say. */
function lastMergePartialCount(taskId: string): number | null {
  const rows = controlEventsMentioning(taskId);
  for (const row of rows) {
    if (!row.payload) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      continue;
    }
    if (
      payload &&
      typeof payload === "object" &&
      (payload as Record<string, unknown>).taskId === taskId &&
      (payload as Record<string, unknown>).kind === "merge-partial"
    ) {
      const count = (payload as Record<string, unknown>).mergedCount;
      return typeof count === "number" ? count : null;
    }
  }
  return null;
}

/** Has the "merged while a session runs" warning already been written for this session? Same
 *  deduplication as `lastMergePartialCount`, for the same reason: a forge redelivers webhooks, and a
 *  task also gets them for comments and updates. The (task, session) pair is the key: two live
 *  sessions on one task each deserve their line, a replayed webhook deserves none. */
function alreadyWarnedMergeDuringSession(taskId: string, sessionId: string): boolean {
  for (const row of controlEventsMentioning(taskId)) {
    if (!row.payload) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      continue;
    }
    const p = payload as Record<string, unknown> | null;
    if (
      p &&
      typeof p === "object" &&
      p.taskId === taskId &&
      p.kind === "merge-during-session" &&
      p.sessionId === sessionId
    )
      return true;
  }
  return false;
}

/** Warns this task's live sessions that the merge just squashed the branch under them (10/09, see
 *  the comment in `handleForgeEvent`). A replayed webhook does not repeat the warning. */
function warnLiveSessionsOfMerge(taskId: string, merged: string[]): void {
  const live = listTaskSessions(taskId).filter((s) =>
    (ACTIVE_STATUSES as readonly string[]).includes(s.status),
  );
  for (const session of live) {
    if (alreadyWarnedMergeDuringSession(taskId, session.id)) continue;
    const message =
      `${merged.join(", ")} merged while this session is running: its branch has just been ` +
      `squashed onto main. What it pushes next starts from a dead base — ` +
      `picking this work up needs a NEW branch, not this one.`;
    publish(session.id, "run_warning", { message });
    logControlEvent("warn", "webhooks", `task ${taskId}: ${message}`, {
      taskId,
      kind: "merge-during-session",
      sessionId: session.id,
      repos: merged,
    });
  }
}

/** What a test can inject: the forge re-read and the transition. */
type HandleDeps = {
  mergeStates: typeof mergeStatesOf;
  complete: typeof completeTask;
};

export type HandleResult = {
  matched: number;
  completed: string[];
  /** True when a re-read returned no readable verdict (repository not resolved, forge silent before
   *  even reaching the adapter): the route then answers non-2xx so the forge marks the delivery
   *  failed and lets it be redelivered. The doorbell rings once, and a merge lost silently would
   *  stay in review forever. */
  unreadable: boolean;
};

/** Finds `review` tasks with a PR at this URL, and only finishes those whose forge confirms all PRs
 *  are merged. Never throws: a misbehaving forge degrades to "nothing moves" + `unreadable`, never
 *  a 500, since a hook accumulating failures ends up disabled by the forge. */
export async function handleForgeEvent(
  ev: ForgeEvent,
  deps: HandleDeps = { mergeStates: mergeStatesOf, complete: completeTask },
): Promise<HandleResult> {
  // In-memory scan over review tasks only: there are a handful, and prUrls is JSON no SQL index
  // queries cleanly. Matching is strict URL equality: both strings come from the same forge API
  // (the creation response for prUrls, the event for the payload), hence the same format.
  const candidates = tasksInReview()
    .map((task) => {
      let prs: { repo: string; url: string }[];
      try {
        prs = JSON.parse(task.prUrls) as { repo: string; url: string }[];
      } catch {
        prs = [];
      }
      return { task, prs };
    })
    .filter(({ prs }) => prs.some((p) => p.url === ev.url));

  if (candidates.length === 0) return { matched: 0, completed: [], unreadable: false };

  if (ev.kind === "closed") {
    // Closed without merge: nothing moves (the work still awaits a decision), but the task says so,
    // or the operator reviews a dead PR without knowing. Once: a redelivered event (forge retry,
    // manual redeliver) must not stack the same line.
    const body = `The change request was closed without being merged: ${ev.url}`;
    for (const { task } of candidates) {
      const already = taskActivityOf(task.id).some((a) => a.body === body);
      if (already) continue;
      insertTaskActivity({
        id: nanoid(10),
        taskId: task.id,
        from: ACTIVITY_FROM.system,
        body,
        createdAt: new Date(),
      });
    }
    return { matched: candidates.length, completed: [], unreadable: false };
  }

  const completed: string[] = [];
  let unreadable = false;
  for (const { task, prs } of candidates) {
    // The re-read decides. `mergeStatesOf` degrades without throwing; an absent `prState` means the
    // re-read did not reach the forge (unreadable number, repository not resolved, adapter threw):
    // no verdict, and we say so. `unknown`/`closed` is not `merged`: in doubt, the task stays.
    const states = await deps.mergeStates(task.projectId, prs);
    if (states.some((s) => s.prState === undefined)) {
      unreadable = true;
      // An anomaly, not a legitimate wait: the forge gave no readable verdict for at least one PR
      // (unreadable number, repository not resolved, token without the right). `unreadable` already
      // told the caller (replayable 503), but it left no trace in the control log. Name the
      // repositories involved: the operator has that information nowhere else.
      const blind = states.filter((s) => s.prState === undefined).map((s) => s.repo);
      logControlEvent(
        "warn",
        "webhooks",
        `task ${task.id}: unreadable re-read for ${blind.join(", ")} — the delivery will be replayed`,
        { taskId: task.id, kind: "merge-unreadable", repos: blind },
      );
      continue;
    }
    // Merging while a session works cuts its branch from under it (10/09).
    //
    // GitHub squashes the PR into one new commit on `main`: the branch's commits are no longer its
    // ancestors. The session keeps pushing to that branch, whose merge base with `main` just died.
    // Its next `make fresh` reports it behind, and any catch-up copies over what `main` gained.
    //
    // Measured on batch 7: session started at 15:05, `#153` merged at 15:14, next PR with 113 diff
    // files for a batch touching 22, `tasks/` and `projects/` included. Nobody did anything wrong:
    // merging is a normal gesture, it was just invisible from the session.
    //
    // Nothing is blocked (merging stays a GitHub gesture, a webhook is not a lock). We say it where
    // it counts: the control log (the operator who just clicked) and the session's trace (whoever
    // reviews what it did next).
    const merged = states.filter((s) => s.prState === "merged").map((s) => s.repo);
    if (merged.length > 0) warnLiveSessionsOfMerge(task.id, merged);

    const allMerged = states.length > 0 && states.every((s) => s.prState === "merged");
    if (!allMerged) {
      // Partial merge: the most frequent case on a multi-repository task, and the quietest before
      // this batch (`continue` left no trace of why the task stays in review). `info`, not `warn`:
      // waiting for a second repository to merge is normal. Deduplicated by
      // `lastMergePartialCount`: a comment or update webhook that leaves the count unchanged writes
      // no duplicate.
      const mergedCount = states.filter((s) => s.prState === "merged").length;
      if (lastMergePartialCount(task.id) !== mergedCount) {
        const waiting = states.filter((s) => s.prState !== "merged").map((s) => s.repo);
        logControlEvent(
          "info",
          "webhooks",
          `task ${task.id}: partial merge ${mergedCount}/${states.length} — waiting for ${waiting.join(", ")}`,
          { taskId: task.id, kind: "merge-partial", mergedCount, total: states.length, waiting },
        );
      }
      continue;
    }
    const result = deps.complete(
      task.id,
      `Change requests merged — task finished by the webhook (${ev.url}).`,
    );
    if (result.ok) {
      completed.push(task.id);
      notifyOut(NOTIF_EVENT.prMerged, { taskId: task.id, task: task.name, url: ev.url });
      // The task's trace (`session_events`) was silent about its own end: a manual or agent `done`
      // leaves a `task_status`, the webhook's left none, and the operator read "session destroyed"
      // with no clue why the task closed (operator request, 03/09, with a screenshot). Set on the
      // task's last session (the one that produced the review): the webhook opens no new one, and
      // that is where the operator already looks. `via`/`url` tell this `done` apart from the
      // agent's or operator's.
      const sessions = listTaskSessions(task.id);
      const lastSession = sessions[sessions.length - 1];
      if (lastSession)
        publish(lastSession.id, "task_status", {
          status: TASK_STATUS.done,
          via: "webhook",
          url: ev.url,
        });
    } else if (!result.alreadyDone) {
      // A refusal other than "already done" deserves a trace: the transition has a reason (batch
      // step, race with the operator) nobody would see otherwise.
      logControlEvent(
        "warn",
        "webhooks",
        `task ${task.id} not finished by the webhook: ${result.reason}`,
        { taskId: task.id },
      );
    }
  }
  return { matched: candidates.length, completed, unreadable };
}
