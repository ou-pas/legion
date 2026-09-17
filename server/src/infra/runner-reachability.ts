// The reachability predicate, separate from the probe that feeds it (06/09): metrics used it and
// the probe called metrics, a cycle over nothing circular. Routing, probe and metrics read this
// pure function without knowing each other. `probe.ts` re-exports it.
import { RUNNER_KIND } from "../shared/enums.js";

/** Often enough that waking a Mac shows, rare enough that a `docker version` per runner costs
 *  nothing. */
export const PROBE_PERIOD_MS = 30_000;
/** TWO periods: with one, a single SSH hiccup would drop the machine and bring it back 30 s later.
 *  We accept routing to a machine dead for under a minute rather than excluding a live one that
 *  coughed. */
export const UNREACHABLE_AFTER_MS = 2 * PROBE_PERIOD_MS;

/** Reachable NOW, for routing. A `process` runner has no daemon: it is reachable exactly when the
 *  control plane is. */
export function runnerReachable(
  runner: { kind: string; lastSeenAt: Date | null },
  now = Date.now(),
): boolean {
  if (runner.kind !== RUNNER_KIND.docker) return true;
  if (!runner.lastSeenAt) return false;
  return now - runner.lastSeenAt.getTime() < UNREACHABLE_AFTER_MS;
}
