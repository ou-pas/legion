// Fleet machine consumption (02/09, operator's request: this task's first session failed with "No
// space left on device" because the mini's Docker VM was full and nothing showed it).
//
// Three measurements, never confused:
//  1. `vm`: what `legion-*` containers consume against what the DAEMON has (`docker info`); the
//     capacity that matters for sessions.
//  2. `host`: the machine itself (load, memory), read over ssh. Like `sessions/runner/caffeinate.ts`,
//     an absence is stated, a machine is never declared unreachable over a comfort measure.
//  3. `disk`: the VM's disk, the incident's cause. A `df /` in the disk sentinel (`disk-sentinel.ts`,
//     a dedicated long-lived container) says what the disk really has; `docker system df` only
//     reports what Docker placed.
//
// This file decides nothing about reachability: callers only use it on a machine whose daemon just
// answered (`infra/probe.ts`). Probing a sleeping machine would add exactly the processes that
// filled the PID table on 01→02/09 (`shared/docker-exec.ts`, section "A sleeping machine must not
// fill the process table" in `docs/wiki/concepts/runner.md`).
import { DOCKER_QUICK_MS, docker, type DockerExec } from "../../shared/docker-exec.js";
import { sshExec, SSH_METRICS_MS, type SshExec } from "../../shared/ssh-exec.js";
import { sshTargetOf } from "../../shared/ssh-target.js";
import { diskSentinelName, ensureDiskSentinel } from "../disk-sentinel.js";
import { SESSION_IMAGE } from "../fleet-images.js";

/** A measurement without its time: `UsageSample` adds it once, in `collectRunnerMetrics`, so two
 *  clocks for one measurement cannot diverge. */
export interface UsageValue {
  cpuPct: number | null;
  memPct: number | null;
}
export interface UsageSample extends UsageValue {
  at: number;
}
export interface DiskInfo {
  usedPct: number;
  totalMb: number;
  at: number;
}
export interface HistoryPoint {
  at: number;
  cpu: number | null;
  mem: number | null;
}

export interface RunnerMetricsSnapshot {
  vm: UsageSample | null;
  /** Why `vm` is `null`; never `null` at the same time as `vm`. */
  vmReason: string | null;
  host: UsageSample | null;
  hostReason: string | null;
  disk: DiskInfo | null;
  diskReason: string | null;
}

/** Sums `legion-*` containers from `docker stats --no-stream --format {{json .}}`. An empty list
 *  gives zeros: a real measurement (nothing runs), not an absence. */
export function aggregateDockerStats(
  ndjson: string,
  prefix = "legion-",
): { cpuSum: number; memUsedMb: number } {
  const rows = ndjson
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, string>];
      } catch {
        return [];
      }
    });
  let cpuSum = 0,
    memUsedMb = 0;
  for (const r of rows) {
    const name = r.Name ?? r.Container ?? "";
    if (!name.startsWith(prefix)) continue;
    const cpu = /^([\d.]+)%$/.exec(String(r.CPUPerc ?? "").trim());
    if (cpu) cpuSum += Number(cpu[1]);
    const mem = memTokenToMb(
      String(r.MemUsage ?? "")
        .split("/")[0]
        ?.trim() ?? "",
    );
    if (mem !== null) memUsedMb += mem;
  }
  return { cpuSum, memUsedMb };
}

/** `"512MiB"`, `"1.943GiB"`, `"128kB"` → MB; `null` on an unrecognised token. */
function memTokenToMb(tok: string): number | null {
  const m = /^([\d.]+)\s*([KMGT]i?B)$/i.exec(tok);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toUpperCase().replace("I", "");
  const factor: Record<string, number> = {
    B: 1 / (1024 * 1024),
    KB: 1 / 1024,
    MB: 1,
    GB: 1024,
    TB: 1024 * 1024,
  };
  const f = factor[unit];
  return f === undefined || !Number.isFinite(n) ? null : n * f;
}

async function collectVm(
  dockerHost: string | null,
  exec: DockerExec,
): Promise<{ sample: UsageValue | null; reason: string | null }> {
  const capR = await exec(
    ["info", "--format", "{{.MemTotal}}|{{.NCPU}}"],
    dockerHost,
    DOCKER_QUICK_MS,
  );
  if (capR.code !== 0)
    return { sample: null, reason: "docker info did not answer: the VM capacity is unknown" };
  const [memTotalStr, ncpuStr] = capR.stdout.trim().split("|");
  const memTotalMb = Number(memTotalStr) > 0 ? Number(memTotalStr) / (1024 * 1024) : null;
  const ncpu = Number(ncpuStr) > 0 ? Number(ncpuStr) : null;

  const statsR = await exec(
    ["stats", "--no-stream", "--format", "{{json .}}"],
    dockerHost,
    DOCKER_QUICK_MS,
  );
  if (statsR.code !== 0) return { sample: null, reason: "docker stats did not answer" };

  const { cpuSum, memUsedMb } = aggregateDockerStats(statsR.stdout);
  // `cpuSum` is in % of ONE core (docker convention); dividing by the VM's cores gives % of TOTAL
  // capacity, the same scale as `memPct`.
  const cpuPct = ncpu ? cpuSum / ncpu : null;
  const memPct = memTotalMb ? Math.min(100, (memUsedMb / memTotalMb) * 100) : null;
  if (cpuPct === null && memPct === null)
    return {
      sample: null,
      reason: "VM capacity unknown (docker info silent): the percentage cannot be computed",
    };
  return { sample: { cpuPct, memPct }, reason: null };
}

const MARK = {
  uptime: "##UPTIME##",
  ncpu: "##NCPU##",
  mem: "##MEMSIZE##",
  vmstat: "##VMSTAT##",
} as const;

/** One ssh connection, one compound command, instead of five connections. */
export function hostProbeCommand(): string {
  // Final `; true`: on a non-mac host `vm_stat`/`sysctl` fail, and `ssh` would exit in error before
  // `parseHostUsage` could read `uname` and name the real reason. The exit code must only say
  // whether the CONNECTION happened; the output is judged on its text.
  return (
    `uname -s; echo '${MARK.uptime}'; uptime; echo '${MARK.ncpu}'; sysctl -n hw.ncpu 2>/dev/null; ` +
    `echo '${MARK.mem}'; sysctl -n hw.memsize 2>/dev/null; echo '${MARK.vmstat}'; vm_stat 2>/dev/null; true`
  );
}

function sectionsOf(raw: string): Record<string, string> {
  const markers = Object.values(MARK);
  const starts = markers.map((m) => ({ m, i: raw.indexOf(m) }));
  const out: Record<string, string> = {};
  starts.forEach(({ m, i }, k) => {
    if (i < 0) {
      out[m] = "";
      return;
    }
    const next =
      starts
        .slice(k + 1)
        .map((x) => x.i)
        .filter((x) => x >= 0)
        .sort((a, b) => a - b)[0] ?? raw.length;
    out[m] = raw.slice(i + m.length, next).trim();
  });
  return out;
}

/** macOS: `load averages: 1.23 2.01 1.98` · Linux: `load average: 0.10, 0.05, 0.01`, accepted even
 *  though `uname` filters Linux out upstream. */
export function parseLoadAverage1(uptimeText: string): number | null {
  const m = /load averages?:\s*([\d.]+)[, ]/.exec(uptimeText);
  return m ? Number(m[1]) : null;
}

/** `active + wired + compressed` is the usual "used memory" approximation on macOS (as Activity
 *  Monitor shows); `free` alone badly undercounts, the kernel keeping cache it would release. */
export function parseVmStatUsedPct(
  vmStatText: string,
  memTotalBytes: number | null,
): number | null {
  if (!memTotalBytes) return null;
  const pageMatch = /page size of (\d+) bytes/.exec(vmStatText);
  const pageSize = pageMatch ? Number(pageMatch[1]) : 4096;
  const grab = (label: string): number | null => {
    const m = new RegExp(`Pages ${label}:\\s+(\\d+)\\.`).exec(vmStatText);
    return m ? Number(m[1]) : null;
  };
  const active = grab("active"),
    wired = grab("wired down"),
    compressed = grab("occupied by compressor");
  if (active === null && wired === null && compressed === null) return null;
  const used = ((active ?? 0) + (wired ?? 0) + (compressed ?? 0)) * pageSize;
  return Math.max(0, Math.min(100, (used / memTotalBytes) * 100));
}

/** `raw` is `hostProbeCommand()`'s raw output. `uname -s` precedes the first marker: a non-Darwin
 *  host lacks the expected `sysctl` and `vm_stat`. */
export function parseHostUsage(raw: string): { sample: UsageValue | null; reason: string | null } {
  const uname = raw
    .slice(0, raw.indexOf(MARK.uptime) >= 0 ? raw.indexOf(MARK.uptime) : raw.length)
    .trim();
  if (!/^darwin/i.test(uname))
    return {
      sample: null,
      reason: "non-mac host: the measurement relies on sysctl/vm_stat, which are macOS-specific",
    };
  const s = sectionsOf(raw);
  const loadAvg1 = parseLoadAverage1(s[MARK.uptime] ?? "");
  const ncpu = Number(s[MARK.ncpu]) || null;
  const memTotalBytes = Number(s[MARK.mem]) || null;
  const cpuPct = loadAvg1 !== null && ncpu ? Math.max(0, (loadAvg1 / ncpu) * 100) : null;
  const memPct = parseVmStatUsedPct(s[MARK.vmstat] ?? "", memTotalBytes);
  if (cpuPct === null && memPct === null)
    return {
      sample: null,
      reason: "unreadable ssh answer: uptime/vm_stat gave nothing usable",
    };
  return { sample: { cpuPct, memPct }, reason: null };
}

async function collectHost(
  dockerHost: string | null,
  ssh: SshExec,
): Promise<{ sample: UsageValue | null; reason: string | null }> {
  if (!dockerHost || !sshTargetOf(dockerHost))
    return {
      sample: null,
      reason: "not an ssh:// host: nothing to query outside the Docker VM",
    };
  const r = await ssh(dockerHost, hostProbeCommand(), SSH_METRICS_MS);
  if (r.code === 124)
    return { sample: null, reason: "budget exceeded: the machine did not answer in time" };
  if (r.code !== 0) {
    const first =
      r.stderr
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean) ?? "unknown cause";
    return { sample: null, reason: `ssh refused: ${first.slice(0, 160)}` };
  }
  return parseHostUsage(r.stdout);
}

/** `df -k /` (forced to KB, not 512-byte blocks). The `NN%` field is located rather than a fixed
 *  column, since a long filesystem name can shift everything. */
export function parseDf(text: string): { usedPct: number; totalMb: number } | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (!last) return null;
  const fields = last.split(/\s+/);
  const pctIdx = fields.findIndex((f) => /^\d+%$/.test(f));
  if (pctIdx < 3) return null;
  const usedPct = Number(fields[pctIdx]!.slice(0, -1));
  const totalKb = Number(fields[pctIdx - 3]);
  if (!Number.isFinite(usedPct) || !Number.isFinite(totalKb) || totalKb <= 0) return null;
  return { usedPct, totalMb: Math.round(totalKb / 1024) };
}

/** 04/09: the old `docker run --rm … df` created a NEW container per probe, which writes an overlay
 *  layer, exactly what fails on a full disk (session `javxU8Wwjx` saw even `git status` break), so
 *  the measure would fail exactly when urgent. Joining a running `legion-*` container fixed that,
 *  but an idle runner had nothing to join and its first session was never protected.
 *
 *  Now `docker exec` joins the disk sentinel, a dedicated long-lived container per runner that
 *  `ensureDiskSentinel` recreates only if missing or stopped. Nothing new is written, even on a
 *  full disk. If creating it fails, the absence is stated with its reason, never an invented number. */
async function collectDisk(
  runnerId: string,
  dockerHost: string | null,
  exec: DockerExec,
): Promise<{ sample: DiskInfo | null; reason: string | null }> {
  const container = diskSentinelName(runnerId);
  try {
    await ensureDiskSentinel(container, SESSION_IMAGE, dockerHost, exec);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { sample: null, reason: `disk sentinel unavailable: ${msg.slice(0, 160)}` };
  }
  const r = await exec(["exec", container, "df", "-k", "/"], dockerHost, DOCKER_QUICK_MS);
  if (r.code !== 0) {
    const first =
      r.stderr
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean) ??
      r.stdout.trim() ??
      "unknown cause";
    return { sample: null, reason: `disk measurement impossible: ${first.slice(0, 160)}` };
  }
  const parsed = parseDf(r.stdout);
  if (!parsed) return { sample: null, reason: "unreadable “df” output" };
  return { sample: { ...parsed, at: Date.now() }, reason: null };
}

export async function collectRunnerMetrics(
  runner: { id: string; dockerHost: string | null },
  deps: { exec?: DockerExec; ssh?: SshExec } = {},
): Promise<RunnerMetricsSnapshot> {
  const exec = deps.exec ?? docker;
  const ssh = deps.ssh ?? sshExec;
  const now = Date.now();
  const [vm, host, disk] = await Promise.all([
    collectVm(runner.dockerHost, exec),
    collectHost(runner.dockerHost, ssh),
    collectDisk(runner.id, runner.dockerHost, exec),
  ]);
  return {
    vm: vm.sample ? { ...vm.sample, at: now } : null,
    vmReason: vm.reason,
    host: host.sample ? { ...host.sample, at: now } : null,
    hostReason: host.reason,
    disk: disk.sample,
    diskReason: disk.reason,
  };
}

/** Minimum free MB before refusing a NEW launch (04/09, task `javxU8Wwjx`: disk at 0 bytes, session
 *  dead mid-commit).
 *
 *  Sized so a refusal leaves room to REPAIR: rebuilding the browser image (3.9 GB, the heavier one),
 *  rounded up. Absolute, not a percentage: 5 % free is 50 GB on a 1 TB disk but 1.6 GB on a 32 GB
 *  VM, and the second case is the one that breaks. */
export const DISK_FREE_MB_MIN = 4096;

/** Free MB derived from `usedPct`, never negative. */
export function diskFreeMb(disk: DiskInfo): number {
  return Math.max(0, Math.round(disk.totalMb * (1 - disk.usedPct / 100)));
}

/** `null` = nothing certainly blocks. Same rule as `preflight.ts`: a missing or stale measure proves
 *  nothing and refuses nothing; only a measured value certainly below the threshold refuses. */
export function diskLaunchBlocker(
  disk: DiskInfo | null,
  minFreeMb = DISK_FREE_MB_MIN,
): string | null {
  if (!disk) return null;
  const freeMb = diskFreeMb(disk);
  if (freeMb >= minFreeMb) return null;
  const fmtGb = (mb: number) => (mb / 1024).toFixed(1);
  return `VM disk almost full: ${fmtGb(freeMb)} GB free, below the ${fmtGb(minFreeMb)} GB threshold`;
}
