// The fleet, one line per machine (v66, 09/09). `/api/infra` costs a `docker ps` per host; a task
// screen only asks which machines exist and which answers, so this reads the registry and the
// probe verdict (`runnerReachable`) without touching docker.
import { allRunners } from "./runner-store.js";
import { runnerReachable } from "./runner-reachability.js";

/** Enough to CHOOSE a machine. `reachable` is the ROUTING verdict, so the screen promises exactly
 *  what the queue will do. */
type RunnerSummary = {
  id: string;
  name: string;
  enabled: boolean;
  reachable: boolean;
};

export function listRunners(): RunnerSummary[] {
  const now = Date.now();
  return allRunners().map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    reachable: runnerReachable(r, now),
  }));
}
