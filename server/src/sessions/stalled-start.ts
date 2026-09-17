// A session that NEVER gets a container (25/08, operator's request).
//
// The gap was named in the code, in both places that sweep sessions, and each was right on its own:
//   · `recoverOrphanSessions` (at boot) spares a `starting` without handle ("the container does not
//     exist yet, killing here is losing a race against ourselves");
//   · `reapDeadSessions` (periodic) excludes `starting` ("where it does not exist yet").
// Nobody came back afterwards. A session stuck there stayed `starting` forever, its task stayed
// `doing`, and the board claimed an agent was working while nothing ran. It happened twice in a row
// on 25/08, Docker stopped.
//
// The root cause is fixed elsewhere (the timeout in `shared/docker-exec.ts`). THIS file is the net:
// it assumes nothing about WHY the container did not come, it observes that after a generous delay
// it is not there, and hands back to the operator.
//
// Why the task goes to later and not todo: `todo` IS the queue. A task returning there is relaunched
// on the next tick, against the same dead Docker, forever. Parking is the only place nothing leaves
// from on its own, which is what we want until a human has looked. The message says where to find
// it.
import { logControlEvent } from "../events/control-log-store.js";
import { startingSessions, taskNameOf } from "./stalled-start-store.js";
import { addNotice } from "../inbox/inbox.js";
import { NOTIF_EVENT, notifyOut } from "../notifications/notify.js";
import { markSessionTerminal } from "./session-terminal.js";
import { applyTaskTransition, TASK_MOVE } from "../tasks/lifecycle.js";

/** Past this delay a missing container is no longer latency. A normal `docker run` returns its
 *  handle in seconds; four minutes cover a slow image load without letting a clear failure rot for
 *  an hour. */
export const STALLED_START_MS = 4 * 60_000;

/** The minimal shape the rule needs, not the whole Drizzle row, so it is testable without a
 *  database. */
export interface StartingLike {
  id: string;
  status: string;
  runtimeHandle: string | null;
  startedAt: Date;
}

/** Sessions stuck BEFORE their container: `starting`, no handle, too old. All three matter: a recent
 *  `starting` is normal, a `starting` WITH handle is the race `recoverOrphanSessions` protects, and
 *  another status is not our business. */
export function stalledStarts<T extends StartingLike>(
  sessions: readonly T[],
  now: number,
  thresholdMs: number = STALLED_START_MS,
): T[] {
  return sessions.filter(
    (s) =>
      s.status === "starting" && !s.runtimeHandle && now - s.startedAt.getTime() >= thresholdMs,
  );
}

/** Names the task, the delay and the ONE thing to check: an alert that does not say what to do only
 *  moves the anxiety around. */
export function stalledMessage(taskName: string, minutes: number): string {
  return (
    `“${taskName}” got no container in ${minutes} min: the session is stopped and the task is ` +
    "saved for later. Check that Docker is running, then move it back to todo."
  );
}

/** Returns the number of sessions stopped. */
export async function sweepStalledStarts(
  now: number = Date.now(),
  thresholdMs: number = STALLED_START_MS,
): Promise<number> {
  const stalled = stalledStarts(startingSessions(), now, thresholdMs);
  if (stalled.length === 0) return 0;

  const minutes = Math.round(thresholdMs / 60_000);
  for (const s of stalled) {
    const taskName = taskNameOf(s.taskId) ?? s.taskId;
    const reason =
      `no container obtained in ${minutes} min — the launch never completed ` +
      "(Docker daemon stopped or unreachable)";
    markSessionTerminal(s.id, "failed", reason, { stalledStart: true });
    // Parking, not the queue (see header). The `doing` filter and dequeuing live in the table
    // (`TASK_MOVE.stall`, tasks/lifecycle.ts), not here.
    applyTaskTransition(s.taskId, TASK_MOVE.stall);
    const message = stalledMessage(taskName, minutes);
    addNotice(message, "task_failed");
    notifyOut(NOTIF_EVENT.taskFailed, { taskId: s.taskId, sessionId: s.id, taskName, reason });
    logControlEvent("warn", "stalled-start", message, { taskId: s.taskId, sessionId: s.id });
  }
  return stalled.length;
}
