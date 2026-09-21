// Infra: Docker monitoring linked to tasks and goals (operator's request 18/08, Phase 5a). For each
// docker runner, `legion-*` containers/networks/volumes are joined with database sessions: links
// both ways, orphans on the Docker side, zombies on the database side, and stale image detection
// (payload hash label against the current files).
import { DOCKER_PROBE_MS, DOCKER_QUICK_MS, docker } from "../shared/docker-exec.js";
import { ACTIVE_STATUSES, SESSION_STATUS } from "../sessions/session-terminal.js";
import { type VolumeRole, parseVolume } from "../sessions/runner/volumes.js";
import {
  FLEET_IMAGE_KEY,
  FLEET_IMAGES,
  type FleetImageState,
  inspectFleetImages,
  repoPlaywrightVersion,
  SESSION_IMAGE as IMAGE,
  currentPayloadHash,
  payloadFiles,
} from "./fleet-images.js";
import { runnerLoad } from "./runner/limits.js";
import { latestRunnerMetrics, runnerMetricsHistory } from "./metrics.js";
import type { DiskInfo, HistoryPoint, UsageSample } from "./metrics/index.js";
import { RUNNER_KIND } from "../shared/enums.js";
import {
  browserContainerRunnerId,
  browserNetworkRunnerId,
  isOrphanBrowserContainer,
  isOrphanBrowserNetwork,
} from "./browser-cleanup.js";
import { diskSentinelRunnerId } from "./disk-sentinel.js";
import { projectImageRebuildRunning } from "./images/project-rebuild.js";
import { runnerProjectImages, type RunnerProjectImage } from "./images/project.js";
import { sessionImageState } from "./images/session.js";
import { sessionsByIds, sessionsInStates, tasksByIds } from "./infra-store.js";
import { allRunners, runnerEnabledMap } from "./runner-store.js";
// `cleanupOrphans` returns refusals with their status (06/09) rather than throwing: importing
// `http/errors.ts` here closes a cycle `make arch` refuses.
import { done, refuse, type Result } from "../http/from-result.js";

// Re-exported from `fleet-images.ts` (09/09) for existing importers.
export { payloadFiles, currentPayloadHash };

// One definition, next to the terminal statuses in sessions/session-terminal.ts.
const ACTIVE_SESSION_STATES = ACTIVE_STATUSES;
const isActive = (status: string) => (ACTIVE_SESSION_STATES as readonly string[]).includes(status);
// A waiting session has NO container (pause destroys it) and a starting one not yet: only these two
// promise a live runtime (review 5a #1).
const RUNTIME_STATES = [SESSION_STATUS.running, SESSION_STATUS.committing] as const;
const STARTING_GRACE_MS = 90_000;
// Not `created`: `docker run -d` passes through it right before running.
const EXITED_STATES = new Set(["exited", "dead"]);

export interface InfraContainer {
  name: string;
  role: "session" | "proxy" | "browser" | "disk-sentinel" | "autre";
  sessionId: string | null;
  state: string; // running | exited | …
  status: string; // "Up 3 minutes": docker's readable uptime
  image: string;
  orphan: boolean;
  // Link to the work (both ways: the task/goal page shows its session too)
  taskId: string | null;
  taskName: string | null;
  goalId: string | null;
  // The task's project, which is also the goal's (a goal spawns its tasks in ITS project). Lets the
  // screen build the canonical `/p/$projectId/tasks/$taskId` without a redirect.
  projectId: string | null;
  sessionStatus: string | null;
}

interface RunnerInfra {
  runnerId: string;
  runnerName: string;
  dockerHost: string | null;
  available: boolean;
  error: string | null;
  containers: InfraContainer[];
  networks: { name: string; sessionId: string | null; orphan: boolean }[];
  /** v52: on a remote runner, volumes hold the session's files (`sessions/runner/volumes.ts`).
   *  `role` tells the workspace (640 MB of dependencies) from the shared cache (never orphan), so the
   *  screen can say what a cleanup costs. */
  volumes: { name: string; role: VolumeRole; sessionId: string | null; orphan: boolean }[];
  /** Active database sessions without a live container: a daemon crash leaves such zombies. */
  zombieSessions: {
    sessionId: string;
    status: string;
    taskId: string;
    taskName: string | null;
    goalId: string | null;
    projectId: string | null;
  }[];
  image: {
    present: boolean;
    builtHash: string | null;
    currentHash: string | null;
    stale: boolean;
    rebuilding: boolean;
  };
  /** Shared images (browser, proxy) and their drift (v53, 03/09); before, a merged browser fix could
   *  stay without effect on runners unseen. Same pattern as `image` (`fleet-images.ts`). */
  sharedImages: FleetImageState[];
  /** Project images seen from this runner (11/09): `image` only probes the default tag, while a
   *  project naming its own launches with THAT one (`sessionImageFor`). Usually empty. */
  projectImages: RunnerProjectImage[];
  /** Counted as the runner selector counts them (runner/limits.ts), so screen and queue agree. */
  maxConcurrentSessions: number;
  running: number;
  /** What each session receives (v38), per runner. */
  memoryMb: number;
  cpus: number;
  /** What the DAEMON really has, in MB (`docker info`); `null` when silent. This ceiling comes
   *  before ours: on Docker Desktop three 4 GB sessions in an 8 GB VM bring the VM down. */
  hostMemoryMb: number | null;
  /** Last answer to the PERIODIC probe (v51), epoch ms. Not `available` (this inspection's finding):
   *  `pickRunnerRow` routes on this, with hysteresis. They diverge only in the minute after a
   *  change, exactly when the operator wants both. */
  lastSeenAt: number | null;
  /** Fleet consumption (v52, 02/09): `vm`, `host`, `disk`, never merged (see `metrics/index.ts`).
   *  Each null measure carries its reason. The histories feed the sparkline; disk has none. */
  metrics: RunnerMetrics;
}

export interface RunnerMetrics {
  vm: UsageSample | null;
  vmReason: string | null;
  vmHistory: HistoryPoint[];
  host: UsageSample | null;
  hostReason: string | null;
  hostHistory: HistoryPoint[];
  disk: DiskInfo | null;
  diskReason: string | null;
}

const NEVER_MEASURED: RunnerMetrics = {
  vm: null,
  vmReason: "not measured yet",
  vmHistory: [],
  host: null,
  hostReason: "not measured yet",
  hostHistory: [],
  disk: null,
  diskReason: "not measured yet",
};

/** Last known measurement (RAM) and recent history (SQLite). A runner never probed yet says so,
 *  rather than a bare `null` reading as "measured and empty". */
function runnerMetricsOf(runnerId: string): RunnerMetrics {
  const snap = latestRunnerMetrics(runnerId);
  const hist = runnerMetricsHistory(runnerId);
  if (!snap) return { ...NEVER_MEASURED, vmHistory: hist.vm, hostHistory: hist.host };
  return {
    vm: snap.vm,
    vmReason: snap.vmReason,
    vmHistory: hist.vm,
    host: snap.host,
    hostReason: snap.hostReason,
    hostHistory: hist.host,
    disk: snap.disk,
    diskReason: snap.diskReason,
  };
}

function parseSessionId(name: string): { role: InfraContainer["role"]; sessionId: string | null } {
  // The browser service (v30) is shared and named per RUNNER: `sessionId: null` escapes the
  // per-session orphan check on purpose. `browser-cleanup.ts` holds the runner criterion.
  if (name.startsWith("legion-browser-")) return { role: "browser", sessionId: null };
  // The disk sentinel (04/09) follows the same pattern.
  if (name.startsWith("legion-disk-sentinel-")) return { role: "disk-sentinel", sessionId: null };
  for (const [prefix, role] of [
    ["legion-session-", "session"],
    ["legion-proxy-", "proxy"],
  ] as const)
    if (name.startsWith(prefix)) return { role, sessionId: name.slice(prefix.length) };
  return { role: "autre", sessionId: null };
}

type SessionLink = {
  status: string;
  runnerId: string;
  taskId: string;
  taskName: string | null;
  goalId: string | null;
  projectId: string | null;
};

/** Task/goal/project link fields, shared by containers and zombies. */
function taskLinkOf(s: SessionLink | undefined) {
  return {
    taskId: s?.taskId ?? null,
    taskName: s?.taskName ?? null,
    goalId: s?.goalId ?? null,
    projectId: s?.projectId ?? null,
  };
}

function sessionJoin(sessionIds: string[]) {
  if (sessionIds.length === 0) return new Map<string, SessionLink>();
  const rows = sessionsByIds(sessionIds);
  const taskIds = [...new Set(rows.map((s) => s.taskId))];
  const tasks = tasksByIds(taskIds);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  return new Map(
    rows.map((s) => {
      const t = taskById.get(s.taskId);
      return [
        s.id,
        {
          status: s.status,
          runnerId: s.runnerId,
          taskId: s.taskId,
          taskName: t?.name ?? null,
          goalId: t?.goalId ?? null,
          projectId: t?.projectId ?? null,
        },
      ];
    }),
  );
}

/** id → enabled for ALL runners, for `browser-cleanup.ts`. Like `load`: a default for a lone caller
 *  (cleanupOrphans), computed once by `infraOverview`. */
function allRunnerEnabledById(): Map<string, boolean> {
  return runnerEnabledMap();
}

async function inspectRunner(
  runner: {
    id: string;
    name: string;
    dockerHost: string | null;
    maxConcurrentSessions: number;
    memoryMb: number;
    cpus: number;
    lastSeenAt: Date | null;
  },
  // Passed by `infraOverview` to query ONCE for N runners; computed here for a lone caller.
  load: Map<string, number> = runnerLoad(),
  runnerEnabledById: ReadonlyMap<string, boolean> = allRunnerEnabledById(),
): Promise<RunnerInfra> {
  const base: RunnerInfra = {
    runnerId: runner.id,
    runnerName: runner.name,
    dockerHost: runner.dockerHost,
    available: false,
    error: null,
    containers: [],
    networks: [],
    volumes: [],
    zombieSessions: [],
    maxConcurrentSessions: runner.maxConcurrentSessions,
    running: load.get(runner.id) ?? 0,
    memoryMb: runner.memoryMb,
    cpus: runner.cpus,
    hostMemoryMb: null,
    lastSeenAt: runner.lastSeenAt?.getTime() ?? null,
    image: {
      present: false,
      builtHash: null,
      currentHash: currentPayloadHash(),
      stale: false,
      rebuilding: false,
    },
    sharedImages: [],
    projectImages: [],
    // The last KNOWN measurement, never recomputed here: `/api/infra` is fetched every 10 s.
    metrics: runnerMetricsOf(runner.id),
  };
  if (process.env.LEGION_INFRA_FAKE === "1") return fakeInfra(base); // UI dev without a daemon

  const ps = await docker(
    ["ps", "-a", "--filter", "name=legion-", "--format", "{{json .}}"],
    runner.dockerHost,
    DOCKER_PROBE_MS,
  );
  if (ps.code !== 0)
    return { ...base, error: (ps.stderr || ps.stdout).slice(0, 300) || "docker indisponible" };
  base.available = true;
  base.hostMemoryMb = await hostMemoryMb(runner.dockerHost);

  // A stray stdout line (ssh banner, docker warning) must not cause a 500 (review 5a #7)
  const parseLines = (out: string): Record<string, string>[] =>
    out
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Record<string, string>];
        } catch {
          return [];
        }
      });
  const rows = parseLines(ps.stdout);
  const join = sessionJoin(
    rows.map((r) => parseSessionId(r.Names ?? "").sessionId).filter((x): x is string => x !== null),
  );

  // A session counts for THIS runner only: a leftover container whose session runs elsewhere is an
  // orphan here (review 5a #5).
  const liveHere = (sessionId: string | null) => {
    if (!sessionId) return null;
    const s = join.get(sessionId);
    return s && s.runnerId === runner.id && isActive(s.status) ? s : null;
  };

  /** Shared services (browser, disk sentinel) are judged by their RUNNER's state; sessions by the
   *  database; image rebuilds by their own state. */
  const containerOrphan = (
    name: string,
    role: InfraContainer["role"],
    sessionId: string | null,
    state: string,
  ) => {
    if (name.startsWith("legion-rebuild-"))
      // Started without `--rm` (images/rebuild.ts): the exited carcass stays until the next rebuild.
      // Its log lives on the host, so only a running rebuild is worth keeping.
      return EXITED_STATES.has(state);
    if (role === "browser")
      // No session to look at: judged by its RUNNER (browser-cleanup.ts).
      return isOrphanBrowserContainer(browserContainerRunnerId(name), runnerEnabledById);
    if (role === "disk-sentinel")
      // Same criterion: despite its name, `isOrphanBrowserContainer` only reads the runner state.
      return isOrphanBrowserContainer(diskSentinelRunnerId(name), runnerEnabledById);
    // Orphan = no matching active session in the database (destroy should have removed it)
    return sessionId !== null && liveHere(sessionId) === null;
  };

  base.containers = rows.map((r) => {
    const name = r.Names ?? "?";
    const { role, sessionId } = parseSessionId(name);
    const s = sessionId ? join.get(sessionId) : undefined;
    return {
      name,
      role,
      sessionId,
      state: r.State ?? "?",
      status: r.Status ?? "",
      image: r.Image ?? "",
      orphan: containerOrphan(name, role, sessionId, r.State ?? "?"),
      ...taskLinkOf(s),
      sessionStatus: s?.status ?? null,
    };
  });

  // `legion-` (v30) also catches `legion-browser-net-<runner>`, judged separately below
  // (browser-cleanup.ts).
  const nets = await docker(
    ["network", "ls", "--filter", "name=legion-", "--format", "{{json .}}"],
    runner.dockerHost,
    DOCKER_PROBE_MS,
  );
  if (nets.code === 0) {
    // Network orphan status comes from the database, NOT container presence: during provisioning
    // the network exists seconds before the session, and removing it would kill it (review 5a #2).
    const netRows = parseLines(nets.stdout);
    const netIds = netRows
      .map((n) =>
        (n.Name ?? "").startsWith("legion-net-")
          ? (n.Name ?? "").slice("legion-net-".length)
          : null,
      )
      .filter((x): x is string => x !== null);
    const netJoin = sessionJoin(netIds);
    // Container and network share the runner id (browserNames): a network without its container on
    // THIS daemon is waste even on an enabled runner (isOrphanBrowserNetwork).
    const browserContainerRunnerIds = new Set(
      base.containers
        .filter((c) => c.role === "browser")
        .map((c) => browserContainerRunnerId(c.name))
        .filter((x): x is string => x !== null),
    );
    base.networks = netRows.map((n) => {
      const name = n.Name ?? "?";
      const browserRunnerId = browserNetworkRunnerId(name);
      if (browserRunnerId !== null)
        return {
          name,
          sessionId: null,
          orphan: isOrphanBrowserNetwork(
            browserRunnerId,
            browserContainerRunnerIds.has(browserRunnerId),
            runnerEnabledById,
          ),
        };
      const sessionId = name.startsWith("legion-net-") ? name.slice("legion-net-".length) : null;
      const s = sessionId ? netJoin.get(sessionId) : undefined;
      return {
        name,
        sessionId,
        orphan: sessionId !== null && !(s && s.runnerId === runner.id && isActive(s.status)),
      };
    });
  }

  // v52: volumes follow the network rule, the DATABASE decides: the secrets volume exists seconds
  // before the session (review 5a #2 applies word for word).
  //
  // Queried on ALL docker runners: filtering on `dockerHost` would hide exactly the runner that was
  // remote then made local and still has something to clean.
  const vols = await docker(
    ["volume", "ls", "--filter", "name=legion-", "--format", "{{json .}}"],
    runner.dockerHost,
    DOCKER_PROBE_MS,
  );
  if (vols.code === 0) {
    const volRows = parseLines(vols.stdout);
    const volJoin = sessionJoin(
      volRows
        .map((v) => parseVolume(v.Name ?? "").sessionId)
        .filter((x): x is string => x !== null),
    );
    base.volumes = volRows.map((v) => {
      const name = v.Name ?? "?";
      const { role, sessionId } = parseVolume(name);
      const s = sessionId ? volJoin.get(sessionId) : undefined;
      return {
        name,
        role,
        sessionId,
        // The shared package cache belongs to no session: never orphan, like the browser service.
        orphan: sessionId !== null && !(s && s.runnerId === runner.id && isActive(s.status)),
      };
    });
  }

  // Zombies: sessions PROMISING a runtime (running/committing) without a live container.
  const containerIds = new Set(
    base.containers
      .filter((c) => c.role === "session" && c.state === "running")
      .map((c) => c.sessionId),
  );
  const now = Date.now();
  const active = sessionsInStates(RUNTIME_STATES)
    .filter((s) => s.runnerId === runner.id && !containerIds.has(s.id))
    .filter((s) => now - new Date(s.startedAt).getTime() > STARTING_GRACE_MS); // provisioning window
  const zjoin = sessionJoin(active.map((s) => s.id));
  base.zombieSessions = active.map((s) => {
    const j = zjoin.get(s.id);
    return {
      sessionId: s.id,
      status: s.status,
      taskId: s.taskId,
      taskName: j?.taskName ?? null,
      goalId: j?.goalId ?? null,
      projectId: j?.projectId ?? null,
    };
  });

  base.image = await sessionImageState(runner, base.image.currentHash);

  // Declared project images seen from this runner (11/09), see the field.
  base.projectImages = await runnerProjectImages(runner, {
    rebuilding: projectImageRebuildRunning,
  });

  // The two other images (v53): what runs on the runner, which the pin drift test (comparing files)
  // cannot see. `fleet-images.ts` owns the single definition of "drifted".
  base.sharedImages = await inspectFleetImages(runner.dockerHost, docker);
  return base;
}

/** What prevents ANY session from starting, as a code; `null` = nothing blocks.
 *
 *  26/08: Docker was off. `available` existed on the Infra page, but nothing put it in the way:
 *  tasks failed with "container gone without a result" and an hour went into Docker layers.
 *
 *  A code, not a sentence: the text belongs to the screen's catalogue. Order matters: an unreachable
 *  daemon makes the image question moot. ALL runners must be down to block. */
export type LaunchBlocker = "daemon" | "image" | null;

export function launchBlocker(
  runners: { available: boolean; image: { present: boolean } }[],
): LaunchBlocker {
  // No enabled runner is missing configuration, not an outage; the Infra page names it.
  if (runners.length === 0) return null;
  if (runners.every((r) => !r.available)) return "daemon";
  if (runners.filter((r) => r.available).every((r) => !r.image.present)) return "image";
  return null;
}

export async function infraOverview() {
  const all = allRunners();
  const runnerEnabledById = new Map(all.map((r) => [r.id, r.enabled]));
  const runners = all.filter((r) => r.kind === RUNNER_KIND.docker && r.enabled);
  const load = runnerLoad();
  const inspected = await Promise.all(
    runners.map((r) => inspectRunner(r, load, runnerEnabledById)),
  );

  // v54, the 03/09 blind spot: disabled runners were never inspected, so what remained on their
  // daemon was invisible, found two days later by counting containers by hand. Same tolerant
  // inspection function.
  const orphanCountOf = (list: RunnerInfra[]) =>
    list.reduce(
      (n, r) =>
        n +
        r.containers.filter((c) => c.orphan).length +
        r.networks.filter((x) => x.orphan).length +
        r.volumes.filter((x) => x.orphan).length,
      0,
    );

  const disabledDocker = all.filter((r) => r.kind === RUNNER_KIND.docker && !r.enabled);
  // ALL disabled runners, not only their residue (08/09). Narrowing to orphans on 04/09 (Legion
  // reported itself as residue on the local socket) also hid a clean disabled runner and its
  // re-enable button. The false positive stays fixed: `orphanCount` only counts orphans, and the
  // screen's red banner reads that count. Listing accuses nobody.
  const disabledRunners = await Promise.all(
    disabledDocker.map((r) => inspectRunner(r, load, runnerEnabledById)),
  );
  return {
    runners: inspected,
    // Kept apart from `runners`: the screen tells serving from sleeping.
    disabledRunners,
    stale: inspected.some((r) => r.available && r.image.stale),
    orphanCount: orphanCountOf(inspected) + orphanCountOf(disabledRunners),
    blocker: launchBlocker(inspected),
  };
}

/** The daemon's memory in MB (on Docker Desktop, the VM allocation). `null` when unusable: no guessed
 *  number for a screen to alert on. */
async function hostMemoryMb(dockerHost: string | null): Promise<number | null> {
  const r = await docker(["info", "--format", "{{.MemTotal}}"], dockerHost, DOCKER_PROBE_MS).catch(
    () => null,
  );
  if (!r || r.code !== 0) return null;
  const bytes = Number(r.stdout.trim());
  return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / (1024 * 1024)) : null;
}

/** Removes a runner's orphan containers, networks and volumes. NEVER touches an active session. */
export async function cleanupOrphans(
  runnerId: string,
): Promise<Result<{ removed: string[]; errors: string[] }>> {
  const runner = allRunners().find((r) => r.id === runnerId && r.kind === RUNNER_KIND.docker);
  if (!runner) return refuse(404, "docker runner not found");
  // Fixture mode: NEVER hit the real docker (review 5a #6)
  if (process.env.LEGION_INFRA_FAKE === "1")
    return done({
      removed: [
        "legion-session-FAKEorphan1",
        "legion-proxy-FAKEorphan1",
        "legion-net-FAKEorphan1",
        "legion-workspace-FAKEorphan1",
        "legion-claude-FAKEorphan1",
      ],
      errors: [],
    });
  const infra = await inspectRunner(runner);
  // 502: THIS machine's daemon did not answer (was 400, blaming the request for an infra outage).
  if (!infra.available) return refuse(502, infra.error ?? "docker indisponible");
  const removed: string[] = [];
  const errors: string[] = [];
  for (const c of infra.containers.filter((x) => x.orphan)) {
    const r = await docker(["rm", "-f", c.name], runner.dockerHost, DOCKER_QUICK_MS);
    (r.code === 0 ? removed : errors).push(
      r.code === 0 ? c.name : `${c.name}: ${r.stderr.slice(0, 120)}`,
    );
  }
  for (const n of infra.networks.filter((x) => x.orphan)) {
    const r = await docker(["network", "rm", n.name], runner.dockerHost, DOCKER_QUICK_MS);
    (r.code === 0 ? removed : errors).push(
      r.code === 0 ? n.name : `${n.name}: ${r.stderr.slice(0, 120)}`,
    );
  }
  // AFTER containers, mandatory: docker refuses to remove a volume mounted by a container, even a
  // stopped one ("volume is in use").
  for (const v of infra.volumes.filter((x) => x.orphan)) {
    const r = await docker(["volume", "rm", v.name], runner.dockerHost, DOCKER_QUICK_MS);
    (r.code === 0 ? removed : errors).push(
      r.code === 0 ? v.name : `${v.name}: ${r.stderr.slice(0, 120)}`,
    );
  }
  return done({ removed, errors });
}

// Fixtures (LEGION_INFRA_FAKE=1): UI dev without a docker daemon.
function fakeInfra(base: RunnerInfra): RunnerInfra {
  const active = sessionsInStates(ACTIVE_SESSION_STATES).slice(0, 2);
  const join = sessionJoin(active.map((s) => s.id));
  const real = active.map((s, i) => {
    const j = join.get(s.id);
    return {
      name: `legion-session-${s.id}`,
      role: "session" as const,
      sessionId: s.id,
      state: "running",
      status: `Up ${7 + i * 3} minutes`,
      image: IMAGE,
      orphan: false,
      taskId: j?.taskId ?? null,
      taskName: j?.taskName ?? null,
      goalId: j?.goalId ?? null,
      projectId: j?.projectId ?? null,
      sessionStatus: s.status,
    };
  });
  return {
    ...base,
    available: true,
    containers: [
      ...real,
      {
        name: "legion-session-FAKEorphan1",
        role: "session",
        sessionId: "FAKEorphan1",
        state: "exited",
        status: "Exited (0) 2 hours ago",
        image: IMAGE,
        orphan: true,
        taskId: null,
        taskName: null,
        goalId: null,
        projectId: null,
        sessionStatus: null,
      },
      {
        name: "legion-proxy-FAKEorphan1",
        role: "proxy",
        sessionId: "FAKEorphan1",
        state: "running",
        status: "Up 2 hours",
        image: "legion-proxy:latest",
        orphan: true,
        taskId: null,
        taskName: null,
        goalId: null,
        projectId: null,
        sessionStatus: null,
      },
      // Shared browser service (v30): long-lived, sessionId null, never orphan.
      {
        name: `legion-browser-${base.runnerId}`,
        role: "browser",
        sessionId: null,
        state: "running",
        status: "Up 3 days",
        image: "legion-browser:latest",
        orphan: false,
        taskId: null,
        taskName: null,
        goalId: null,
        projectId: null,
        sessionStatus: null,
      },
      // Disk sentinel (04/09): same pattern, session image reused.
      {
        name: `legion-disk-sentinel-${base.runnerId}`,
        role: "disk-sentinel",
        sessionId: null,
        state: "running",
        status: "Up 3 days",
        image: IMAGE,
        orphan: false,
        taskId: null,
        taskName: null,
        goalId: null,
        projectId: null,
        sessionStatus: null,
      },
    ],
    networks: [{ name: "legion-net-FAKEorphan1", sessionId: "FAKEorphan1", orphan: true }],
    // The shared cache is here to be seen as non-orphan, a case the screen renders differently.
    volumes: [
      {
        name: "legion-workspace-FAKEorphan1",
        role: "workspace",
        sessionId: "FAKEorphan1",
        orphan: true,
      },
      {
        name: "legion-claude-FAKEorphan1",
        role: "claude-state",
        sessionId: "FAKEorphan1",
        orphan: true,
      },
      { name: "legion-pkg-cache", role: "autre", sessionId: null, orphan: false },
    ],
    zombieSessions: [],
    image: {
      present: true,
      builtHash: "deadbeef",
      currentHash: base.image.currentHash,
      stale: true,
      rebuilding: false,
    },
    // Stale browser, fresh proxy: the contrast the screen must render. Versions from the 03/09
    // outage.
    sharedImages: FLEET_IMAGES.map((spec) => {
      const browser = spec.key === FLEET_IMAGE_KEY.browser;
      return {
        key: spec.key,
        tag: spec.tag,
        makeTarget: spec.makeTarget,
        present: true,
        builtHash: browser ? "deadbeef" : "cafe1234",
        currentHash: "cafe1234",
        stale: browser,
        builtVersion: browser ? "1.49.1" : null,
        currentVersion: browser ? repoPlaywrightVersion() : null,
      };
    }),
    // Demo metrics (v52), DETERMINISTIC (no Math.random) so successive renders do not shift.
    metrics: fakeMetrics(),
  };
}

function fakeMetrics(): RunnerMetrics {
  const at = Date.now();
  const wave = (base: number, amp: number) =>
    Array.from({ length: 20 }, (_, i) => Math.round(base + amp * Math.sin(i / 2)));
  const history = (cpuBase: number, memBase: number): HistoryPoint[] =>
    wave(cpuBase, 15).map((cpu, i) => ({
      at: at - (19 - i) * 30_000,
      cpu,
      mem: wave(memBase, 8)[i]!,
    }));
  return {
    vm: { cpuPct: 42, memPct: 58, at },
    vmReason: null,
    vmHistory: history(42, 58),
    host: { cpuPct: 18, memPct: 64, at },
    hostReason: null,
    hostHistory: history(18, 64),
    disk: { usedPct: 47, totalMb: 61_440, at },
    diskReason: null,
  };
}
