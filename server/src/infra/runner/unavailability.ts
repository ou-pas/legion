// A runner unavailable for a reason no Legion action repairs (12/09): Docker down or disk full;
// the operator must go to the machine. Without this, `assertRunnerReady` refuses, the session
// fails, the queue requeues it and `pumpQueue` retries thirty seconds later against the same
// machine, forever, with nothing visible changing.
//
// This module only holds the fact "unavailable since when, and why", in memory, keyed by runner
// (a machine fact, not a task fact). Probing lives in `sessions/runner/chosen-runner.ts`, moving
// tasks in `unavailability-sweep.ts`. Kept separate to avoid a cycle: `tasks/task-serialize.ts`
// reads this state for the board badge, and `infra/runner/ → tasks/` would close one.
//
// In memory, no migration: a control plane restart costs one more failed session, no data.

/** The two `assertRunnerReady` refusals no Legion button repairs. */
export const RUNNER_UNAVAILABLE_REASON = {
  dockerDown: "docker-down",
  diskFull: "disk-full",
} as const;

export type RunnerUnavailableReason =
  (typeof RUNNER_UNAVAILABLE_REASON)[keyof typeof RUNNER_UNAVAILABLE_REASON];

/** Past this delay without recovery the task moves to Later (`unavailability-sweep.ts`). More
 *  generous than `STALLED_START_MS` (4 min): time for an operator to notice and restart the
 *  machine. */
export const RUNNER_UNAVAILABLE_ESCALATE_AFTER_MS = 15 * 60_000;

interface UnavailableEntry {
  runnerName: string;
  reason: RunnerUnavailableReason;
  message: string;
  since: Date;
  /** Tasks `pumpQueue` saw waiting on THIS runner, accumulated tick by tick; the sweep moves them
   *  to Later. */
  waitingTaskIds: Set<string>;
}

/** Read view without the mutable `Set`, which a caller could clear believing it a copy. */
export interface RunnerUnavailability {
  runnerName: string;
  reason: RunnerUnavailableReason;
  message: string;
  since: Date;
  waitingTaskIds: readonly string[];
}

const unavailable = new Map<string, UnavailableEntry>();

/** Idempotent for the SAME reason: `since` does not move (that is what makes the fifteen minutes
 *  hold); only message and name refresh. A DIFFERENT reason is a new outage and restarts the clock.
 *
 *  `runnerName` travels with the entry so neither this leaf module nor `task-serialize.ts` imports
 *  the runner store; the caller already has the row. */
export function markRunnerUnavailable(
  runnerId: string,
  runnerName: string,
  reason: RunnerUnavailableReason,
  message: string,
): void {
  const existing = unavailable.get(runnerId);
  if (existing && existing.reason === reason) {
    existing.runnerName = runnerName;
    existing.message = message;
    return;
  }
  unavailable.set(runnerId, {
    runnerName,
    reason,
    message,
    since: new Date(),
    waitingTaskIds: new Set(),
  });
}

/** Recovery seen by the probe (`chosen-runner.ts`) or after the sweep escalated. */
export function clearRunnerUnavailable(runnerId: string): void {
  unavailable.delete(runnerId);
}

/** Only if the entry still carries this reason: `assertRunnerReady` checks daemon then disk, and a
 *  daemon answering again must not clear a disk still full. */
export function clearRunnerUnavailableReason(
  runnerId: string,
  reason: RunnerUnavailableReason,
): void {
  if (unavailable.get(runnerId)?.reason === reason) unavailable.delete(runnerId);
}

/** No effect if the runner is no longer marked (a recovery raced in): the task is picked next round. */
export function noteTaskWaitingOnRunner(runnerId: string, taskId: string): void {
  unavailable.get(runnerId)?.waitingTaskIds.add(taskId);
}

function toView(entry: UnavailableEntry): RunnerUnavailability {
  return { ...entry, waitingTaskIds: [...entry.waitingTaskIds] };
}

export function runnerUnavailability(runnerId: string): RunnerUnavailability | null {
  const entry = unavailable.get(runnerId);
  return entry ? toView(entry) : null;
}

/** For the periodic sweep. */
export function unavailableRunnerEntries(): [string, RunnerUnavailability][] {
  return [...unavailable.entries()].map(([runnerId, entry]) => [runnerId, toView(entry)]);
}

/** For the board badge (`task-serialize.ts`): which machine holds THIS task back. Linear in the
 *  number of machines down, never in tasks. */
export function runnerWaitForTask(taskId: string): {
  runnerId: string;
  runnerName: string;
  reason: RunnerUnavailableReason;
  message: string;
  since: Date;
} | null {
  for (const [runnerId, entry] of unavailable) {
    if (entry.waitingTaskIds.has(taskId)) {
      return {
        runnerId,
        runnerName: entry.runnerName,
        reason: entry.reason,
        message: entry.message,
        since: entry.since,
      };
    }
  }
  return null;
}

/** Reset for tests, like `resetMetricsStoreForTests` (infra/metrics/store.ts). */
export function resetRunnerUnavailabilityForTests(): void {
  unavailable.clear();
}
