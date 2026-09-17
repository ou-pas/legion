// The consumption probe (02/09): three measurements, three distinct ways to fail without crashing,
// and one rule: an absence is STATED with its reason, never guessed from a bare `null`. `exec`/`ssh`
// are injected; no test touches a real daemon or ssh.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DockerExec, DockerResult } from "../../shared/docker-exec.js";
import type { SshExec, SshResult } from "../../shared/ssh-exec.js";
import {
  aggregateDockerStats,
  collectRunnerMetrics,
  diskFreeMb,
  diskLaunchBlocker,
  hostProbeCommand,
  parseDf,
  parseHostUsage,
  parseLoadAverage1,
  parseVmStatUsedPct,
} from "./index.js";

const ok = (stdout = ""): DockerResult => ({ code: 0, stdout, stderr: "" });
const ko = (stderr: string, code = 1): DockerResult => ({ code, stdout: "", stderr });

const HOST_OK =
  "Darwin\n" +
  "##UPTIME##\n21:04  up 3 days, 10:22, 2 users, load averages: 1.23 2.01 1.98\n" +
  "##NCPU##\n8\n" +
  "##MEMSIZE##\n17179869184\n" +
  "##VMSTAT##\nMach Virtual Memory Statistics: (page size of 4096 bytes)\n" +
  "Pages free:                              100000.\n" +
  "Pages active:                            500000.\n" +
  "Pages wired down:                        300000.\n" +
  "Pages occupied by compressor:             20000.\n";

describe("aggregateDockerStats: counts ONLY legion-* containers", () => {
  it("sums CPU% and used MB, ignores unprefixed containers", () => {
    const ndjson = [
      { Name: "legion-session-abc", CPUPerc: "12.50%", MemUsage: "512MiB / 1.907GiB" },
      { Name: "legion-proxy-abc", CPUPerc: "0.05%", MemUsage: "3.2MiB / 1.907GiB" },
      { Name: "something-else", CPUPerc: "99.00%", MemUsage: "1GiB / 2GiB" },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n");
    const { cpuSum, memUsedMb } = aggregateDockerStats(ndjson);
    assert.ok(Math.abs(cpuSum - 12.55) < 0.01, `cpuSum=${cpuSum}`);
    assert.ok(Math.abs(memUsedMb - 515.2) < 0.5, `memUsedMb=${memUsedMb}`);
  });

  it("no active legion-* container: zero, not an absence", () => {
    assert.deepEqual(aggregateDockerStats(""), { cpuSum: 0, memUsedMb: 0 });
  });

  it("a stray line (ssh banner) does not break the sum, same guard as docker ps", () => {
    const ndjson =
      "ssh: warning banner\n" +
      JSON.stringify({ Name: "legion-x", CPUPerc: "1.00%", MemUsage: "10MiB / 1GiB" });
    assert.deepEqual(aggregateDockerStats(ndjson), { cpuSum: 1, memUsedMb: 10 });
  });
});

describe("parseDf: the threshold that would have shown the 02/09 incident", () => {
  it("reads total and used % on the last line, whatever the column widths", () => {
    const text =
      "Filesystem     1024-blocks     Used Available Capacity Mounted on\n" +
      "overlay           61255492 58192517   2996800      96% /\n";
    const r = parseDf(text);
    assert.ok(r);
    assert.equal(r!.usedPct, 96);
    assert.equal(r!.totalMb, Math.round(61255492 / 1024));
  });

  it("unreadable output → null, never an invented number", () => {
    assert.equal(parseDf(""), null);
    assert.equal(parseDf("whatever\n"), null);
  });
});

describe("parseLoadAverage1 / parseVmStatUsedPct: the machine itself", () => {
  it('macOS load: "load averages: 1.23 2.01 1.98" → 1.23', () => {
    assert.equal(parseLoadAverage1("21:04  up 3 days, load averages: 1.23 2.01 1.98"), 1.23);
  });

  it('Linux load (just in case): "load average: 0.10, 0.05, 0.01" → 0.10', () => {
    assert.equal(parseLoadAverage1("up 3 days, load average: 0.10, 0.05, 0.01"), 0.1);
  });

  it("vm_stat: active + wired + compressed, over the sysctl total", () => {
    const vmstat =
      "Mach Virtual Memory Statistics: (page size of 4096 bytes)\n" +
      "Pages active:                            500000.\n" +
      "Pages wired down:                        300000.\n" +
      "Pages occupied by compressor:             20000.\n";
    const memTotal = 17_179_869_184; // 16 GiB
    const pct = parseVmStatUsedPct(vmstat, memTotal);
    const expectedUsed = (500_000 + 300_000 + 20_000) * 4096;
    assert.ok(Math.abs(pct! - (expectedUsed / memTotal) * 100) < 0.01);
  });

  it('no recognised "Pages …" line → null, not 0 %', () => {
    assert.equal(parseVmStatUsedPct("charabia", 1024), null);
  });
});

describe("parseHostUsage: the task's three tolerances", () => {
  it("complete Darwin host: cpuPct and memPct computed", () => {
    const { sample, reason } = parseHostUsage(HOST_OK);
    assert.equal(reason, null);
    assert.ok(sample);
    assert.ok(Math.abs(sample!.cpuPct! - (1.23 / 8) * 100) < 0.01);
    assert.ok(sample!.memPct! > 0 && sample!.memPct! < 100);
  });

  it("non-mac host: reason named, never a machine called unreachable for it", () => {
    const { sample, reason } = parseHostUsage(
      "Linux\n##UPTIME##\nup, load average: 0.1, 0.1, 0.1\n",
    );
    assert.equal(sample, null);
    assert.match(reason ?? "", /non-mac/);
  });

  it("Darwin but unreadable answer (empty sections): a reason, not a crash", () => {
    const { sample, reason } = parseHostUsage("Darwin\n");
    assert.equal(sample, null);
    assert.match(reason ?? "", /unreadable/);
  });
});

describe("hostProbeCommand: one connection, never five", () => {
  it("carries the four markers and ends with a neutral exit code", () => {
    const cmd = hostProbeCommand();
    for (const m of ["##UPTIME##", "##NCPU##", "##MEMSIZE##", "##VMSTAT##"])
      assert.ok(cmd.includes(m));
    assert.ok(
      cmd.trim().endsWith("true"),
      "the exit code must only say whether the connection happened",
    );
  });
});

describe("collectRunnerMetrics: end to end, exec/ssh injected", () => {
  const fakeExec =
    (script: (args: string[]) => DockerResult): DockerExec =>
    (args) =>
      Promise.resolve(script(args));
  const fakeSsh =
    (script: (cmd: string) => SshResult): SshExec =>
    (_host, cmd) =>
      Promise.resolve(script(cmd));

  it("everything answers: vm, host and disk carry a value, no reason", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "info") return ok("17179869184|4"); // 16 GiB, 4 cores
      if (args[0] === "stats")
        return ok(
          JSON.stringify({
            Name: "legion-session-a",
            CPUPerc: "50.00%",
            MemUsage: "1GiB / 16GiB",
          }),
        );
      if (args[0] === "inspect") return ok("true\n"); // disk sentinel already running
      if (args[0] === "exec")
        return ok(
          "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 1000000 300000 700000 30% /\n",
        );
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    const ssh = fakeSsh(() => ({ code: 0, stdout: HOST_OK, stderr: "" }));
    const snap = await collectRunnerMetrics(
      { id: "mini", dockerHost: "ssh://operator@mini" },
      { exec, ssh },
    );

    assert.ok(snap.vm && snap.vmReason === null);
    assert.ok(Math.abs(snap.vm!.cpuPct! - 12.5) < 0.01, `cpuPct=${snap.vm!.cpuPct}`); // 50/4
    assert.ok(snap.host && snap.hostReason === null);
    assert.deepEqual(snap.disk, {
      usedPct: 30,
      totalMb: Math.round(1_000_000 / 1024),
      at: snap.disk!.at,
    });
    assert.equal(snap.diskReason, null);
  });

  it("the disk sentinel is already running: `exec` only, never a `run` to measure", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "info") return ok("1073741824|1");
      if (args[0] === "stats") return ok("");
      if (args[0] === "inspect") {
        assert.equal(args[3], "legion-disk-sentinel-mini");
        return ok("true\n");
      }
      if (args[0] === "exec") {
        assert.equal(
          args[1],
          "legion-disk-sentinel-mini",
          "probes THE sentinel, never another container",
        );
        return ok(
          "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 2000 1000 1000 50% /\n",
        );
      }
      if (args[0] === "run")
        throw new Error("the sentinel already exists: it must NEVER be recreated to measure");
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    const snap = await collectRunnerMetrics(
      { id: "mini", dockerHost: null },
      { exec, ssh: fakeSsh(() => ({ code: 0, stdout: "", stderr: "" })) },
    );
    assert.equal(snap.disk?.usedPct, 50);
  });

  it("IDLE runner (no legion-* container, the 04/09 blind spot): the sentinel is created ONCE, the measure still works", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "info") return ok("1073741824|1");
      if (args[0] === "stats") return ok(""); // no session: a real zero, not a gap
      if (args[0] === "inspect") return ko("No such container: legion-disk-sentinel-mini", 1); // never created
      if (args[0] === "run") {
        assert.equal(args[3], "legion-disk-sentinel-mini");
        assert.ok(args.includes("none"), "no network route: the sentinel only needs to exist");
        return ok();
      }
      if (args[0] === "exec")
        return ok(
          "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 4000 1000 3000 25% /\n",
        );
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    const snap = await collectRunnerMetrics(
      { id: "mini", dockerHost: null },
      { exec, ssh: fakeSsh(() => ({ code: 0, stdout: "", stderr: "" })) },
    );
    assert.equal(
      snap.disk?.usedPct,
      25,
      "before this fix, an idle runner ALWAYS returned null here",
    );
    assert.equal(snap.diskReason, null);
  });

  it("sentinel missing AND creation impossible (disk already full on the first round): the absence is stated, never an invented number", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "info") return ok("1073741824|1");
      if (args[0] === "stats") return ok("");
      if (args[0] === "inspect") return ko("No such container", 1);
      if (args[0] === "run") return ko("no space left on device", 1);
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    const snap = await collectRunnerMetrics(
      { id: "mini", dockerHost: null },
      { exec, ssh: fakeSsh(() => ({ code: 0, stdout: "", stderr: "" })) },
    );
    assert.equal(snap.disk, null);
    assert.match(snap.diskReason ?? "", /disk sentinel unavailable/);
  });

  it("local runner (no dockerHost): the VM answers, the machine question does not arise", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "info") return ok("1073741824|1");
      if (args[0] === "stats") return ok("");
      if (args[0] === "inspect") return ok("true\n");
      if (args[0] === "exec") return ko("OCI runtime exec failed: no such container");
      throw new Error(`unexpected call: ${args.join(" ")}`);
    });
    const ssh = fakeSsh(() => {
      throw new Error("must never be called without an ssh:// dockerHost");
    });
    const snap = await collectRunnerMetrics({ id: "mini", dockerHost: null }, { exec, ssh });

    assert.deepEqual(snap.vm, { cpuPct: 0, memPct: 0, at: snap.vm!.at });
    assert.equal(snap.host, null);
    assert.match(snap.hostReason ?? "", /not an ssh:\/\/ host/);
    assert.equal(snap.disk, null);
    assert.match(snap.diskReason ?? "", /disk measurement impossible/);
  });

  it("ssh refused and budget exceeded: two distinct reasons, never confused", async () => {
    const exec = fakeExec(() => ok("1073741824|1"));

    const refused = await collectRunnerMetrics(
      { id: "mini", dockerHost: "ssh://operator@mini" },
      { exec, ssh: fakeSsh(() => ({ code: 255, stdout: "", stderr: "Connection refused" })) },
    );
    assert.match(refused.hostReason ?? "", /ssh refused/);

    const timedOut = await collectRunnerMetrics(
      { id: "mini", dockerHost: "ssh://operator@mini" },
      { exec, ssh: fakeSsh(() => ({ code: 124, stdout: "", stderr: "" })) },
    );
    assert.match(timedOut.hostReason ?? "", /budget exceeded/);
  });

  it("docker info silent: the VM is absent with its reason, disk stays independent", async () => {
    const exec = fakeExec((args) => {
      if (args[0] === "info") return ko("Cannot connect", 1);
      if (args[0] === "inspect") return ok("true\n");
      if (args[0] === "exec")
        return ok(
          "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 1000 500 500 50% /\n",
        );
      throw new Error(`unexpected call (stats must not be attempted): ${args.join(" ")}`);
    });
    const snap = await collectRunnerMetrics(
      { id: "mini", dockerHost: null },
      { exec, ssh: fakeSsh(() => ({ code: 0, stdout: "", stderr: "" })) },
    );
    assert.equal(snap.vm, null);
    assert.match(snap.vmReason ?? "", /docker info/);
    assert.ok(snap.disk, "disk does not depend on docker info");
  });
});

describe("diskFreeMb / diskLaunchBlocker: the threshold that would have refused the 04/09 launch", () => {
  it("computes free MB from usedPct", () => {
    assert.equal(diskFreeMb({ usedPct: 90, totalMb: 32_000, at: 0 }), 3_200);
    assert.equal(diskFreeMb({ usedPct: 100, totalMb: 32_000, at: 0 }), 0);
  });

  it("no known measurement: nothing blocks, only the CERTAIN is refused", () => {
    assert.equal(diskLaunchBlocker(null), null);
  });

  it("above the threshold: nothing blocks", () => {
    assert.equal(diskLaunchBlocker({ usedPct: 50, totalMb: 32_000, at: 0 }), null);
  });

  it("below the threshold (04/09, 0 bytes free): the refusal NAMES the margin", () => {
    const msg = diskLaunchBlocker({ usedPct: 100, totalMb: 32_000, at: 0 });
    assert.match(msg ?? "", /VM disk almost full/);
    assert.match(msg ?? "", /0\.0 GB free/);
  });

  it("the threshold is adjustable for tests without changing the production default", () => {
    assert.equal(diskLaunchBlocker({ usedPct: 90, totalMb: 32_000, at: 0 }, 2_000), null);
    assert.ok(diskLaunchBlocker({ usedPct: 90, totalMb: 32_000, at: 0 }, 4_000));
  });
});
