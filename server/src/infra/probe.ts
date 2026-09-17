// Fleet health probe (01/09, multi-machine work, slice 01). The control plane runs on an always-on
// weak home server; sessions run on strong machines that SLEEP. "Pure ssh:// plus probe": the
// server calls, but checks first. Without it `pickRunnerRow` would send a task to a sleeping Mac,
// the session would stay `starting`, and the operator would look for the fault in Docker.
//
// 1. The probe is light: `docker version` only, not `infraOverview`'s full inspection, every 30 s.
// 2. The threshold is two periods (see `runner-reachability.ts`).
// 3. Only transitions go to the control log: a line every 30 s per runner would drown it.
import { dockerDaemonReachable } from "../shared/docker-exec.js";
import { sampleReachableRunnerMetrics } from "./metrics.js";
import { PROBE_PERIOD_MS, UNREACHABLE_AFTER_MS, runnerReachable } from "./runner-reachability.js";
import { RUNNER_KIND } from "../shared/enums.js";
import { createLogger } from "../shared/log.js";
import { logControlEvent } from "../events/control-log-store.js";
import { enabledRunners, updateRunner } from "./runner-store.js";

// Reachability transitions go to `control_events` (below); this logger only carries a crashing
// pass's diagnostic.
const log = createLogger("probe");

// The predicate and its period live in `runner-reachability.ts` since 06/09; re-exported here.
export { PROBE_PERIOD_MS, UNREACHABLE_AFTER_MS, runnerReachable };

type RunnerRow = {
  id: string;
  name: string;
  kind: string;
  dockerHost: string | null;
  lastSeenAt: Date | null;
};

/** Same shape as `dockerDaemonReachable`, which backs it in production. */
export type ProbeVerdict = { ok: true } | { ok: false; why: string };
export type Prober = (runner: { kind: string; dockerHost: string | null }) => Promise<ProbeVerdict>;

/** `LEGION_INFRA_FAKE=1` (UI dev without a daemon) answers yes without calling anything. The fake
 *  lives here, not in `runnerReachable`, so the predicate stays pure. */
export const dockerProbe: Prober = async (runner) => {
  if (runner.kind !== RUNNER_KIND.docker) return { ok: true };
  if (process.env.LEGION_INFRA_FAKE === "1") return { ok: true };
  return dockerDaemonReachable(runner.dockerHost);
};

/** Separate from the loop: `POST /api/runners` calls it immediately, so a new runner is not
 *  unreachable by default until the first pass. */
export async function probeAndRecord(
  runner: RunnerRow,
  probe: Prober = dockerProbe,
  now = Date.now(),
): Promise<ProbeVerdict> {
  const verdict = await probe(runner);
  // Silence does not erase the last answer: it and the hysteresis decide.
  if (verdict.ok) updateRunner(runner.id, { lastSeenAt: new Date(now) });
  return verdict;
}

/** Last known verdict per runner, to write only TRANSITIONS. In memory on purpose: after a restart
 *  the first pass announces nothing; comparing with the database would announce "reachable again"
 *  at every boot. */
const lastVerdict = new Map<string, boolean>();

/** Tests only. */
export function resetProbeStateForTests(): void {
  lastVerdict.clear();
}

/** ONE pass over enabled runners; public so tests run it round by round with their own clock. */
export async function probeRunners(opts: { now?: number; probe?: Prober } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  const rows = enabledRunners();
  await Promise.all(
    rows.map(async (row) => {
      const verdict = await probeAndRecord(row, opts.probe ?? dockerProbe, now);
      // An answer means reachable; silence lets the old date (and the hysteresis) decide.
      const is = verdict.ok || runnerReachable(row, now);
      const was = lastVerdict.get(row.id);
      lastVerdict.set(row.id, is);
      if (was === undefined || was === is) return;
      if (is)
        logControlEvent("info", "probe", `runner “${row.name}” reachable again`, {
          runnerId: row.id,
        });
      else
        logControlEvent(
          "warn",
          "probe",
          `runner “${row.name}” unreachable: no answer for ${UNREACHABLE_AFTER_MS / 1000} s`,
          { runnerId: row.id, why: verdict.ok ? null : verdict.why },
        );
    }),
  );
}

/** Returns a stop function. The first pass runs IMMEDIATELY: at boot `last_seen_at` dates from the
 *  previous process, and waiting 30 s would leave the whole fleet unreachable. */
export function startRunnerProbe(): () => void {
  // Metrics (v52, 02/09) run AFTER the probe, reading the freshly advanced `last_seen_at`.
  const tick = () =>
    void probeRunners()
      .then(() => sampleReachableRunnerMetrics())
      .catch((e: unknown) =>
        log.warn("probe pass failed", { error: String((e as Error)?.message ?? e) }),
      );
  tick();
  const timer = setInterval(tick, PROBE_PERIOD_MS);
  timer.unref();
  return () => clearInterval(timer);
}
