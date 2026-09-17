// Metrics retention and probing rules. `RETENTION_MS` and `HISTORY_POINTS` are product decisions;
// the reachability predicate is the routing one, so "reachable" means the same everywhere. The
// store (`metrics/store.ts`) receives them as parameters.
import type { DockerExec } from "../shared/docker-exec.js";
import type { SshExec } from "../shared/ssh-exec.js";
import {
  latestRunnerMetrics,
  runnerMetricsHistory as historyStore,
  sampleReachableRunnerMetrics as sampleReachableStore,
  sampleRunnerMetrics as sampleStore,
} from "./metrics/store.js";
import { runnerReachable } from "./runner-reachability.js";

export { latestRunnerMetrics };

/** 48 h (operator's decision, 02/09): beyond that the screen only shows a trend, not an incident. */
export const RETENTION_MS = 48 * 3600 * 1000;

/** Not the full 48 h: `/api/infra` is polled every 10 s. One hour (120 points at 30 s) shows a
 *  trend without weighing on the response. */
export const HISTORY_POINTS = 120;

export async function sampleRunnerMetrics(
  runner: { id: string; dockerHost: string | null },
  deps: { exec?: DockerExec; ssh?: SshExec } = {},
) {
  return sampleStore(runner, RETENTION_MS, deps);
}

export function runnerMetricsHistory(runnerId: string) {
  return historyStore(runnerId, HISTORY_POINTS);
}

/** The production entry point: probes reachable runners (the routing predicate). */
export async function sampleReachableRunnerMetrics(
  now = Date.now(),
  deps: { exec?: DockerExec; ssh?: SshExec } = {},
): Promise<void> {
  return sampleReachableStore(runnerReachable, RETENTION_MS, now, deps);
}
