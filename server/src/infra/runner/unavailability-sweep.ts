// The fifteen-minute net (12/09), like `sessions/stalled-start.ts`: past that delay, leaving tasks
// in `todo` would claim "queued" for tasks nothing will resume without a human at the machine.
// `pumpQueue` skips them and probes recovery; this module escalates when recovery does not come.
import { logControlEvent } from "../../events/control-log-store.js";
import { addNotice } from "../../inbox/notices.js";
import { applyTaskTransition, TASK_MOVE } from "../../tasks/lifecycle.js";
import { taskRow } from "../../sessions/runner/manager-store.js";
import {
  clearRunnerUnavailable,
  RUNNER_UNAVAILABLE_ESCALATE_AFTER_MS,
  unavailableRunnerEntries,
} from "./unavailability.js";

const REASON_LABEL: Record<string, string> = {
  "docker-down": "Docker is not answering",
  "disk-full": "the disk is full",
};

/** Same shape as `stalledMessage`: the machine, the reason, the tasks, and the one action. */
export function runnerUnavailableMessage(
  runnerName: string,
  reason: string,
  minutes: number,
  taskNames: readonly string[],
): string {
  const label = REASON_LABEL[reason] ?? reason;
  return (
    `“${runnerName}”: ${label} for ${minutes} min. ${taskNames.length} task(s) saved ` +
    `for later: ${taskNames.map((n) => `“${n}”`).join(", ")}. Check the machine, ` +
    "then move them back to todo."
  );
}

/** Returns the number of runners escalated, not tasks. */
export function sweepUnavailableRunners(now: number = Date.now()): number {
  let escalated = 0;
  for (const [runnerId, entry] of unavailableRunnerEntries()) {
    if (now - entry.since.getTime() < RUNNER_UNAVAILABLE_ESCALATE_AFTER_MS) continue;
    const taskIds = entry.waitingTaskIds;
    if (taskIds.length === 0) {
      // Nobody waits on it any more: nothing to escalate, but forget the fact so a machine coming
      // back later does not inherit a stale clock.
      clearRunnerUnavailable(runnerId);
      continue;
    }
    const movedNames: string[] = [];
    const movedIds: string[] = [];
    for (const taskId of taskIds) {
      if (!applyTaskTransition(taskId, TASK_MOVE.park)) continue;
      movedIds.push(taskId);
      movedNames.push(taskRow(taskId)?.name ?? taskId);
    }
    if (movedIds.length > 0) {
      const minutes = Math.round(RUNNER_UNAVAILABLE_ESCALATE_AFTER_MS / 60_000);
      const message = runnerUnavailableMessage(entry.runnerName, entry.reason, minutes, movedNames);
      addNotice(message, "runner_unavailable");
      logControlEvent("warn", "runner-unavailable", message, {
        runnerId,
        reason: entry.reason,
        taskIds: movedIds,
      });
      escalated += 1;
    }
    clearRunnerUnavailable(runnerId);
  }
  return escalated;
}
