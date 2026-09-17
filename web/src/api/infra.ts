import { json, patch, post } from "./client.js";

/** Mirror of `CONTROL_LEVEL` (server/src/shared/enums.ts). */
export const CONTROL_LEVEL = { info: "info", warn: "warn", error: "error" } as const;
export const CONTROL_LEVELS = [
  CONTROL_LEVEL.info,
  CONTROL_LEVEL.warn,
  CONTROL_LEVEL.error,
] as const;
export type ControlLevel = (typeof CONTROL_LEVELS)[number];

export type InfraContainer = {
  name: string;
  // "autre" is the server's wire value (server/src/infra/infra.ts), kept as is.
  role: "session" | "proxy" | "browser" | "disk-sentinel" | "autre";
  sessionId: string | null;
  state: string;
  status: string;
  image: string;
  orphan: boolean;
  taskId: string | null;
  taskName: string | null;
  goalId: string | null;
  /** The task's project (nav/B): without it the screen can only build the short `/t/$taskId` URL,
   *  which redirects. `null` only when `taskId` is. */
  projectId: string | null;
  sessionStatus: string | null;
};
export type InfraRunner = {
  runnerId: string;
  runnerName: string;
  dockerHost: string | null;
  available: boolean;
  error: string | null;
  containers: InfraContainer[];
  networks: { name: string; sessionId: string | null; orphan: boolean }[];
  /** v52. On a remote runner (`docker_host` ssh://) a session's files are docker volumes, not host
   *  folders: that is where the 640 MB of dependencies a cleanup frees live. Empty on a local
   *  runner, and that is not a gap. `role` tells the workspace from the shared cache, never orphan. */
  volumes: { name: string; role: string; sessionId: string | null; orphan: boolean }[];
  zombieSessions: {
    sessionId: string;
    status: string;
    taskId: string;
    taskName: string | null;
    goalId: string | null;
    /** Same contract as `InfraContainer.projectId`. */
    projectId: string | null;
  }[];
  image: {
    present: boolean;
    builtHash: string | null;
    currentHash: string | null;
    stale: boolean;
    rebuilding: boolean;
  };
  /** Shared fleet images, browser and proxy (03/09). `image` above only covers the session; these
   *  two were visible nowhere and the update did not rebuild them, so a merged browser fix could
   *  stay without effect until an agent hit it. The server compares a label stamped at build with
   *  what the repo describes now, and `builtVersion`/`currentVersion` NAME the browser drift
   *  (Playwright versions). */
  sharedImages: FleetImage[];
  /** Declared project images seen from this runner (11/09). `image` above only probes the default
   *  session tag; a project naming its own (Kopee.me) stayed invisible here although that is the
   *  image its launches use. Usually empty. No rebuild gesture here: it lives on the project page
   *  (`SessionRuntimeCard`). */
  projectImages: RunnerProjectImage[];
  /** Concurrent session cap and seats taken now. The count follows the runner selector's
   *  definition: a session in an inbox pause has no container, so it takes no seat. */
  maxConcurrentSessions: number;
  running: number;
  /** What each session gets (v38), per runner. */
  memoryMb: number;
  cpus: number;
  /** What the daemon really has (`docker info`), `null` when it does not answer. This is the cap:
   *  on Docker Desktop the VM has its own allocation. */
  hostMemoryMb: number | null;
  /** Last time the daemon answered the PERIODIC probe, epoch ms. `null` = never since declared.
   *
   *  Not `available`, which is what the current inspection just saw. `lastSeenAt` decides ROUTING:
   *  the server sends no session to a machine silent for two probe periods. They only diverge in
   *  the minute after a state change, which is exactly when someone looks at this screen. */
  lastSeenAt: number | null;
  /** Fleet consumption (v52, 02/09), three measures never merged. `vm` is the Docker VM (what
   *  `legion-*` containers use), `host` the machine hosting it (read over ssh, absent on a local or
   *  non-mac runner), `disk` the VM's disk (the 02/09 incident: "No space left on device" with
   *  nothing to show it). Each `null` measure carries its reason, never a bare `null`. */
  metrics: RunnerMetrics;
};
/** A shared image on ONE runner: what the daemon has and what the repo says. `makeTarget` is the
 *  command that catches up, shown rather than left to guess. */
export type FleetImage = {
  key: "browser" | "proxy";
  tag: string;
  makeTarget: string;
  present: boolean;
  builtHash: string | null;
  currentHash: string | null;
  stale: boolean;
  builtVersion: string | null;
  currentVersion: string | null;
};
/** A project image seen from an Infra card runner, the counterpart of `ProjectImageState`
 *  (`api/projects.ts`) plus `projectId`/`projectName`, since here the runner is fixed and the
 *  project varies. */
export type RunnerProjectImage = {
  projectId: string;
  projectName: string;
  image: {
    tag: string;
    dockerfile: { present: boolean; valid: boolean; error: string | null };
    present: boolean;
    builtHash: string | null;
    currentHash: string | null;
    stale: boolean;
    rebuilding: boolean;
  };
};
export type UsageSample = { cpuPct: number | null; memPct: number | null; at: number };
export type DiskInfo = { usedPct: number; totalMb: number; at: number };
export type HistoryPoint = { at: number; cpu: number | null; mem: number | null };
export type RunnerMetrics = {
  vm: UsageSample | null;
  vmReason: string | null;
  vmHistory: HistoryPoint[];
  host: UsageSample | null;
  hostReason: string | null;
  hostHistory: HistoryPoint[];
  disk: DiskInfo | null;
  diskReason: string | null;
};
/** Returned by `POST /api/runners`: the declared machine and what the immediate probe says. */
export type DeclaredRunner = {
  id: string;
  name: string;
  dockerHost: string | null;
  callbackUrl: string | null;
  maxConcurrentSessions: number;
  reachable: boolean;
  error: string | null;
};
/** What prevents ANY session from starting. A code, not a sentence: the server knows which block
 *  is true (infra.ts), the screen knows how to say it. */
export type LaunchBlocker = "daemon" | "image" | null;
export type Infra = {
  runners: InfraRunner[];
  /** Disabled runners still holding something (v54, 03/09). A disabled runner was not even probed,
   *  so a browser service created while it served stayed invisible on its daemon. Usually empty;
   *  non-empty means something is left to remove where the screen never looked. Same shape as
   *  `runners`, so the same cleanup button applies. */
  disabledRunners: InfraRunner[];
  stale: boolean;
  orphanCount: number;
  blocker: LaunchBlocker;
};
export type ImageTarget = "session" | "browser" | "proxy";
export type ImageRebuildStarted = {
  runnerId: string;
  runnerName: string;
  targets: ImageTarget[];
  logPath: string;
};
/** Cleanup attached to a lifecycle gesture (disable, delete): same shape as `infraCleanup` plus
 *  `skipped`. The gesture succeeds even when cleanup could not be attempted (`process` runner,
 *  unreachable daemon), and the reason is shown instead of kept silent. */
export type RunnerCleanupOutcome = { removed: string[]; errors: string[]; skipped: string | null };
/** A session blocking a lifecycle gesture. The error message already says why; this only types
 *  `live`. */
export type LiveSession = { id: string; status: string };

/** Control plane log (`GET /api/control-events`): boot, migrations, seed, preflight, queue,
 *  recovered sessions, integrations. `source` is an open string on the server: new values can
 *  appear without a client change. */
export type ControlEventLevel = "info" | "warn" | "error";
export type ControlEvent = {
  id: number;
  level: ControlEventLevel;
  source: string;
  message: string;
  payload: unknown | null;
  createdAt: number;
};

/** v66. The fleet, one line per machine (`GET /api/runners`), for CHOOSING. `reachable` is the
 *  server's ROUTING verdict: the screen neither recomputes nor guesses it from a measure.
 *  Deliberately narrower than `InfraRunner`, which costs a `docker ps` per host on every read. */
export type RunnerSummary = { id: string; name: string; enabled: boolean; reachable: boolean };

export const infraApi = {
  infra: (): Promise<Infra> => fetch("/api/infra").then(json),
  /** No docker call behind it. */
  runners: (): Promise<RunnerSummary[]> => fetch("/api/runners").then(json),
  infraCleanup: (runnerId: string): Promise<{ removed: string[]; errors: string[] }> =>
    post(`/api/infra/${runnerId}/cleanup`),
  /** Rebuilds an image ON THIS runner (07/09), the update's gesture for the one machine that slept
   *  through it. Returns at once (202): the result shows in `image.rebuilding` then `stale` as
   *  `/api/infra` is reread. */
  rebuildImage: (runnerId: string, target: ImageTarget): Promise<ImageRebuildStarted> =>
    post(`/api/infra/${runnerId}/rebuild-image`, { targets: [target] }),
  /** The server probes the machine BEFORE answering: `reachable` says whether its daemon answered
   *  at once, `error` why not. */
  declareRunner: (body: {
    name: string;
    dockerHost?: string;
    callbackUrl?: string;
    maxConcurrentSessions?: number;
  }): Promise<DeclaredRunner> => post("/api/runners", body),
  /** Lowering below the current load is allowed and kills nothing: the queue stops launching,
   *  started sessions finish. */
  setConcurrency: (
    runnerId: string,
    maxConcurrentSessions: number,
  ): Promise<{
    runnerId: string;
    runnerName: string;
    maxConcurrentSessions: number;
    running: number;
  }> => patch(`/api/runners/${runnerId}`, { maxConcurrentSessions }),
  /** Running sessions do not change: a container's limits are fixed at creation. */
  setResources: (runnerId: string, body: { memoryMb?: number; cpus?: number }) =>
    patch(`/api/runners/${runnerId}`, body),
  /** (04/09) Disabling cleans containers/networks/volumes IN THE SAME server gesture; `cleanup`
   *  carries the result. 409 while a session is alive on the runner (`client.ts` relays the
   *  message). Re-enabling cleans nothing, and `skipped` says so rather than an unexplained empty
   *  array. */
  setRunnerEnabled: (
    runnerId: string,
    enabled: boolean,
  ): Promise<{
    runner: { id: string; name: string; enabled: boolean };
    cleanup: RunnerCleanupOutcome;
  }> => patch(`/api/runners/${runnerId}`, { enabled }),
  /** Deletes a runner declared by mistake. Succeeds ONLY for a machine that never carried a session
   *  (database FK); one that ran ("local") always refuses with 409 and says so. Not a bug to work
   *  around: only `setRunnerEnabled` undoes a runner in service. */
  deleteRunner: (
    runnerId: string,
  ): Promise<{
    runnerId: string;
    runnerName: string;
    cleanup: RunnerCleanupOutcome;
  }> => fetch(`/api/runners/${runnerId}`, { method: "DELETE" }).then(json),
  /** Read-only: no write route exists for control events. */
  controlEvents: (
    params: { level?: ControlEventLevel; limit?: number } = {},
  ): Promise<ControlEvent[]> => {
    const qs = new URLSearchParams();
    if (params.level) qs.set("level", params.level);
    if (params.limit) qs.set("limit", String(params.limit));
    const suffix = qs.toString();
    return fetch(`/api/control-events${suffix ? `?${suffix}` : ""}`).then(json);
  },
};
