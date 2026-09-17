// Fleet consumption memory (02/09): two lifetimes, never confused.
//
// `latest` lives in RAM, never in `control_events`: each runner's last KNOWN value with its age, so
// the screen shows something even if the latest pass failed. A log receiving a line every 30 s per
// runner is a log nobody reads (same rule as `infra/probe.ts`).
//
// `runner_metrics` (v52) is the HISTORY, VM and machine only, not disk (a threshold has no trend).
// Filled and purged in the SAME pass (operator's decision 02/09: SQLite, no new dependency for two
// machines).
//
// `sampleReachableRunnerMetrics` probes runners passing the reachability predicate, which the
// `infra/metrics.ts` facade sets to `runnerReachable` (the routing predicate). The defence against
// the night of 01→02/09 (9,000 orphan processes on two sleeping Macs): an unreachable machine gets
// NO further command, not even a measurement.
import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "../../shared/db.js";
import type { DockerExec } from "../../shared/docker-exec.js";
import type { SshExec } from "../../shared/ssh-exec.js";
import { createLogger } from "../../shared/log.js";

// A failed measurement is a diagnostic of the moment, not a fact to read back (see header).
const log = createLogger("metrics");
import { collectRunnerMetrics, type HistoryPoint, type RunnerMetricsSnapshot } from "./index.js";
import { METRIC_SOURCE } from "./metrics-enums.js";
import type { MetricSource } from "./metrics-enums.js";

const latest = new Map<string, RunnerMetricsSnapshot>();

/** `undefined` if none yet (not probed since server start, or just declared). */
export function latestRunnerMetrics(runnerId: string): RunnerMetricsSnapshot | undefined {
  return latest.get(runnerId);
}

/** Tests only, like `resetProbeStateForTests`. */
export function resetMetricsStoreForTests(): void {
  latest.clear();
}

/** Tests only: sets a measurement without probing, so routing decisions (`pickRunnerRow` skipping a
 *  full disk) are testable without a fake daemon; `store.test.ts` covers the probe itself. */
export function setRunnerMetricsForTests(runnerId: string, snapshot: RunnerMetricsSnapshot): void {
  latest.set(runnerId, snapshot);
}

/** Probes ONE runner: RAM immediately, VM/machine history in the database, purge right after.
 *  Separate so tests can skip reachability. */
export async function sampleRunnerMetrics(
  runner: { id: string; dockerHost: string | null },
  retentionMs: number,
  deps: { exec?: DockerExec; ssh?: SshExec } = {},
): Promise<RunnerMetricsSnapshot> {
  const snap = await collectRunnerMetrics(runner, deps);
  latest.set(runner.id, snap);

  const rows: (typeof schema.runnerMetrics.$inferInsert)[] = [];
  if (snap.vm)
    rows.push({
      runnerId: runner.id,
      at: new Date(snap.vm.at),
      source: METRIC_SOURCE.vm,
      cpu: snap.vm.cpuPct,
      mem: snap.vm.memPct,
    });
  if (snap.host)
    rows.push({
      runnerId: runner.id,
      at: new Date(snap.host.at),
      source: METRIC_SOURCE.host,
      cpu: snap.host.cpuPct,
      mem: snap.host.memPct,
    });
  if (rows.length) db.insert(schema.runnerMetrics).values(rows).run();
  db.delete(schema.runnerMetrics)
    .where(lt(schema.runnerMetrics.at, new Date(Date.now() - retentionMs)))
    .run();

  return snap;
}

/** Oldest to newest (sparkline order), VM and machine separate. Empty for a runner without rows yet.
 *  `historyPoints` is per source. */
export function runnerMetricsHistory(
  runnerId: string,
  historyPoints: number,
): {
  vm: HistoryPoint[];
  host: HistoryPoint[];
} {
  const rows = db
    .select()
    .from(schema.runnerMetrics)
    .where(eq(schema.runnerMetrics.runnerId, runnerId))
    .orderBy(desc(schema.runnerMetrics.at))
    .limit(historyPoints * 2)
    .all();
  const toPoints = (source: MetricSource): HistoryPoint[] =>
    rows
      .filter((r) => r.source === source)
      .reverse()
      .map((r) => ({ at: r.at.getTime(), cpu: r.cpu, mem: r.mem }));
  return { vm: toPoints("vm"), host: toPoints("host") };
}

/** Probes enabled docker runners the predicate accepts NOW. One failure is logged and does not
 *  affect the others. */
export async function sampleReachableRunnerMetrics(
  reachabilityPredicate: (
    runner: { kind: string; lastSeenAt: Date | null },
    now: number,
  ) => boolean,
  retentionMs: number,
  now = Date.now(),
  deps: { exec?: DockerExec; ssh?: SshExec } = {},
): Promise<void> {
  const rows = db
    .select()
    .from(schema.runners)
    .where(and(eq(schema.runners.enabled, true), eq(schema.runners.kind, "docker")))
    .all();
  await Promise.all(
    rows
      .filter((r) => reachabilityPredicate(r, now))
      .map((r) =>
        sampleRunnerMetrics(r, retentionMs, deps).catch((e: unknown) =>
          log.warn("measurement failed", {
            runner: r.name,
            error: String((e as Error)?.message ?? e),
          }),
        ),
      ),
  );
}
