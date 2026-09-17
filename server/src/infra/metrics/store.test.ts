// Consumption memory (02/09):
//  1. RAM keeps the last known measurement, immediately.
//  2. `runner_metrics` (VM + machine) writes and purges (48 h) in the SAME pass.
//  3. `sampleReachableRunnerMetrics` NEVER probes a runner `runnerReachable` says is asleep: the
//     defence against 9,000 orphan processes on two sleeping Macs (01→02/09).
//  4. A probe that throws stays ISOLATED to its runner: the others are still measured and the
//     failure is logged, never swallowed (lot 13, S1, task `6cMh01EY8n`).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-metrics-store-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { eq } = await import("drizzle-orm");
const {
  latestRunnerMetrics,
  resetMetricsStoreForTests,
  runnerMetricsHistory,
  sampleReachableRunnerMetrics,
  sampleRunnerMetrics,
} = await import("./store.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");
const { METRIC_SOURCE } = await import("./metrics-enums.js");

const R = "r-metrics";
const T0 = Date.UTC(2026, 8, 2, 8, 0, 0);

function reset(): void {
  db.delete(schema.runnerMetrics).run();
  db.delete(schema.runners).run();
  resetMetricsStoreForTests();
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

/** Always answers and remembers each host queried, which proves a sleeping runner got NO call. */
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

describe("sampleRunnerMetrics: immediate RAM, VM+host history, purge in the same pass", () => {
  beforeEach(() => reset());

  it("writes the last known in RAM and one history row per measured source", async () => {
    runner(R, new Date(T0));
    const { exec, ssh } = fakeDeps();
    const RETENTION_MS = 48 * 3600 * 1000;
    await sampleRunnerMetrics({ id: R, dockerHost: "ssh://mini" }, RETENTION_MS, { exec, ssh });

    const snap = latestRunnerMetrics(R);
    assert.ok(snap?.vm, "the VM must carry a measurement");
    assert.ok(snap?.host, "the machine must carry a measurement");
    assert.equal(snap?.disk, null, "the disk measure image is missing in this fake exec");

    const HISTORY_POINTS = 120;
    const hist = runnerMetricsHistory(R, HISTORY_POINTS);
    assert.equal(hist.vm.length, 1);
    assert.equal(hist.host.length, 1);
    // Disk has NO history: only vm/host write to runner_metrics.
    const rows = db.select().from(schema.runnerMetrics).all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.source).sort(), ["host", "vm"]);
  });

  it("purges rows older than 48 h on EVERY pass", async () => {
    // Dates are relative to NOW, not the fixed `T0`: the purge reads `Date.now()`, so data anchored
    // to a fixed date ages on its own. This test once put its "recent" row at `T0 - 1 h`
    // (2026-09-02 07:00) and failed on `main` on 2026-09-04 around 08:00 without any code change.
    // Calendar-anchored data against clock-driven code has an expiry date.
    const now = Date.now();
    const RETENTION_MS = 48 * 3600 * 1000;
    runner(R, new Date(now));
    db.insert(schema.runnerMetrics)
      .values([
        {
          runnerId: R,
          at: new Date(now - 49 * 3600 * 1000),
          source: METRIC_SOURCE.vm,
          cpu: 10,
          mem: 10,
        },
        {
          runnerId: R,
          at: new Date(now - 1 * 3600 * 1000),
          source: METRIC_SOURCE.vm,
          cpu: 20,
          mem: 20,
        },
      ])
      .run();
    const { exec, ssh } = fakeDeps();
    await sampleRunnerMetrics({ id: R, dockerHost: "ssh://mini" }, RETENTION_MS, { exec, ssh });

    const rows = db
      .select()
      .from(schema.runnerMetrics)
      .where(eq(schema.runnerMetrics.runnerId, R))
      .all();
    const vmRows = rows.filter((r) => r.source === METRIC_SOURCE.vm);
    // The 49 h row is gone; the 1 h one and the new one remain.
    assert.equal(vmRows.length, 2);
    assert.ok(vmRows.every((r) => r.at.getTime() > now - RETENTION_MS));
  });
});

describe("sampleReachableRunnerMetrics: a sleeping machine is NOT probed", () => {
  beforeEach(() => reset());

  it("queries the reachable runner, leaves the sleeping one UNTOUCHED (zero calls)", async () => {
    runner("r-awake", new Date(T0), "ssh://awake"); // just answered
    runner("r-asleep", new Date(T0 - 3 * 60_000), "ssh://asleep"); // 3 min of silence, well past two 30 s periods

    const { exec, ssh, hosts } = fakeDeps();
    const RETENTION_MS = 48 * 3600 * 1000;
    const { runnerReachable } = await import("../runner-reachability.js");
    await sampleReachableRunnerMetrics(runnerReachable, RETENTION_MS, T0, { exec, ssh });

    assert.ok(hosts.includes("ssh://awake"), "the awake runner must have been queried");
    assert.ok(!hosts.includes("ssh://asleep"), "the sleeping runner must receive NO command");
    assert.ok(latestRunnerMetrics("r-awake"), "the awake runner has a measurement in RAM");
    assert.equal(
      latestRunnerMetrics("r-asleep"),
      undefined,
      "the sleeping runner has nothing: it was never probed",
    );
  });

  it("a `process` runner is never probed for metrics: it has no daemon", async () => {
    db.insert(schema.runners)
      .values({
        id: "r-proc",
        name: "r-proc",
        kind: RUNNER_KIND.process,
        dockerHost: null,
        lastSeenAt: new Date(T0),
      })
      .run();
    const { exec, ssh, hosts } = fakeDeps();
    const RETENTION_MS = 48 * 3600 * 1000;
    const { runnerReachable } = await import("../runner-reachability.js");
    await sampleReachableRunnerMetrics(runnerReachable, RETENTION_MS, T0, { exec, ssh });
    assert.deepEqual(hosts, []);
    assert.equal(latestRunnerMetrics("r-proc"), undefined);
  });
});

describe("sampleReachableRunnerMetrics: a probe that throws does not stop the others", () => {
  beforeEach(() => reset());

  /** Captures stderr during an ASYNC `run`; `shared/log.test.ts` only covers the sync case. */
  async function captureStderr(run: () => Promise<void>): Promise<string[]> {
    const err: string[] = [];
    const real = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => (err.push(String(chunk)), true);
    try {
      await run();
    } finally {
      process.stderr.write = real;
    }
    return err;
  }

  it("logs ONE runner's failure, does not reject, and still measures the others", async () => {
    runner("r-ok", new Date(T0), "ssh://ok");
    runner("r-boom", new Date(T0), "ssh://boom");
    const RETENTION_MS = 48 * 3600 * 1000;
    const { runnerReachable } = await import("../runner-reachability.js");

    // The real `docker`/`sshExec` never reject (failures are `{ code: 1 }`); this fake simulates an
    // UNEXPECTED exception (SQLite, a future bug).
    const exec = (_args: string[], dockerHost: string | null) => {
      if (dockerHost === "ssh://boom") throw new Error("simulated failure");
      return Promise.resolve({ code: 0, stdout: "1073741824|1", stderr: "" });
    };
    const ssh = (dockerHost: string) => {
      if (dockerHost === "ssh://boom") throw new Error("simulated failure");
      return Promise.resolve({
        code: 0,
        stderr: "",
        stdout:
          "Darwin\n##UPTIME##\nup, load averages: 0.5 0 0\n##NCPU##\n1\n##MEMSIZE##\n1073741824\n##VMSTAT##\n",
      });
    };

    const err = await captureStderr(() =>
      sampleReachableRunnerMetrics(runnerReachable, RETENTION_MS, T0, { exec, ssh }),
    );

    assert.ok(
      latestRunnerMetrics("r-ok"),
      "the healthy runner must be measured despite the failure",
    );
    assert.equal(
      latestRunnerMetrics("r-boom"),
      undefined,
      "the failed runner has no measurement: never an invented number",
    );
    assert.equal(err.length, 1, "the failure is logged once, on stderr");
    assert.match(err[0]!, /measurement failed/);
    assert.match(err[0]!, /r-boom/);
    assert.match(err[0]!, /simulated failure/);
  });
});
