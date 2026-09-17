// The rules facade (PR #174): proves the WIRING, that `RETENTION_MS`, `HISTORY_POINTS` and
// `runnerReachable` from `metrics.ts` are what the three functions pass to the store. The store
// only knows what it is given, so its own tests (`metrics/store.test.ts`) cannot see this.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-metrics-facade-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  HISTORY_POINTS,
  RETENTION_MS,
  runnerMetricsHistory,
  sampleReachableRunnerMetrics,
  sampleRunnerMetrics,
} = await import("./metrics.js");
const { resetMetricsStoreForTests, latestRunnerMetrics } = await import("./metrics/store.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { METRIC_SOURCE } = await import("./metrics/metrics-enums.js");

const R = "r-metrics-facade";

function reset(): void {
  db.delete(schema.runnerMetrics).run();
  db.delete(schema.runners).run();
  resetMetricsStoreForTests();
}

/** Always answers and remembers each host queried, proving a sleeping runner got NO call. */
function fakeDeps() {
  const hosts: string[] = [];
  const exec = (args: string[], dockerHost: string | null) => {
    hosts.push(dockerHost ?? "local");
    if (args[0] === "info") return Promise.resolve({ code: 0, stdout: "1073741824|1", stderr: "" });
    if (args[0] === "stats")
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ Name: "legion-x", CPUPerc: "10%", MemUsage: "10MiB / 1024MiB" }),
        stderr: "",
      });
    return Promise.resolve({ code: 1, stdout: "", stderr: "no such image" });
  };
  const ssh = (dockerHost: string) => {
    hosts.push(dockerHost);
    return Promise.resolve({
      code: 0,
      stderr: "",
      stdout:
        "Darwin\n##UPTIME##\nup, load averages: 0.5 0 0\n##NCPU##\n1\n##MEMSIZE##\n1073741824\n##VMSTAT##\n",
    });
  };
  return { exec, ssh, hosts };
}

function runner(
  id: string,
  lastSeenAt: Date | null,
  dockerHost: string | null = "ssh://mini",
): void {
  db.insert(schema.runners)
    .values({ id, name: id, kind: RUNNER_KIND.docker, dockerHost, lastSeenAt })
    .run();
}

describe("sampleRunnerMetrics (facade) passes RETENTION_MS to the store", () => {
  beforeEach(() => reset());

  it("purges a row older than RETENTION_MS, keeps a younger one", async () => {
    // Dates relative to now (see metrics/store.test.ts: a calendar date ages on its own).
    const now = Date.now();
    runner(R, new Date(now));
    db.insert(schema.runnerMetrics)
      .values([
        {
          runnerId: R,
          at: new Date(now - RETENTION_MS - 60_000),
          source: METRIC_SOURCE.vm,
          cpu: 1,
          mem: 1,
        },
        {
          runnerId: R,
          at: new Date(now - RETENTION_MS + 60_000),
          source: METRIC_SOURCE.vm,
          cpu: 2,
          mem: 2,
        },
      ])
      .run();
    const { exec, ssh } = fakeDeps();
    await sampleRunnerMetrics({ id: R, dockerHost: "ssh://mini" }, { exec, ssh });

    const rows = db.select().from(schema.runnerMetrics).all();
    // With another duration, the `+ 60 s` row would remain or the `- 60 s` one would be gone: the
    // exact threshold proves THIS constant applied.
    assert.ok(
      rows.every((r) => r.at.getTime() > now - RETENTION_MS),
      "no row older than RETENTION_MS may survive",
    );
    assert.ok(
      rows.some((r) => r.cpu === 2),
      "the row younger than RETENTION_MS must survive",
    );
  });
});

describe("runnerMetricsHistory (facade) passes HISTORY_POINTS to the store", () => {
  beforeEach(() => reset());

  it("caps history at HISTORY_POINTS per source, not an arbitrary number", async () => {
    runner(R, new Date());
    const extra = 20; // more rows than the facade must return
    const rows: (typeof schema.runnerMetrics.$inferInsert)[] = [];
    const now = Date.now();
    // Alternating vm/host a minute apart: the newest `2 * HISTORY_POINTS` rows hold EXACTLY
    // HISTORY_POINTS of each source, independent of insertion order.
    for (let i = 0; i < HISTORY_POINTS + extra; i++) {
      const at = new Date(now - i * 60_000);
      rows.push({ runnerId: R, at, source: METRIC_SOURCE.vm, cpu: i, mem: i });
      rows.push({
        runnerId: R,
        at: new Date(at.getTime() - 30_000),
        source: METRIC_SOURCE.host,
        cpu: i,
        mem: i,
      });
    }
    db.insert(schema.runnerMetrics).values(rows).run();

    const hist = runnerMetricsHistory(R);
    // Any other number would make one count differ from the exported constant.
    assert.equal(hist.vm.length, HISTORY_POINTS);
    assert.equal(hist.host.length, HISTORY_POINTS);
  });
});

describe("sampleReachableRunnerMetrics (facade) passes runnerReachable, the routing predicate", () => {
  beforeEach(() => reset());

  it("probes the reachable runner, leaves the sleeping one UNTOUCHED (zero calls)", async () => {
    const now = Date.now();
    runner("r-awake", new Date(now), "ssh://awake"); // just answered
    runner("r-asleep", new Date(now - 3 * 60_000), "ssh://asleep"); // silent well past the hysteresis

    const { exec, ssh, hosts } = fakeDeps();
    await sampleReachableRunnerMetrics(now, { exec, ssh });

    // Without the predicate the sleeping runner would be probed: the night of 01→02/09.
    assert.ok(hosts.includes("ssh://awake"), "the awake runner must have been queried");
    assert.ok(!hosts.includes("ssh://asleep"), "the sleeping runner must receive NO command");
    assert.ok(latestRunnerMetrics("r-awake"), "the awake runner has a measurement in RAM");
    assert.equal(
      latestRunnerMetrics("r-asleep"),
      undefined,
      "the sleeping runner has nothing: it was never probed",
    );
  });
});
