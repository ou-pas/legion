// Rebuilding an image on one machine, on demand (07/09, operator's request). A Mac asleep during
// an update stays stale until the next one; on 07/09 one machine missed three in a row, and the Infra
// card only showed a global banner without naming the machine or offering the action.
//
// The update's script restricted to one runner and the requested images (`rebuildOneImageLines`):
// same ephemeral container, socket, clone mount and `.ssh` copy. It does NOT fetch, reset or run
// `up.sh`, so the control plane stays up and the result shows in `/api/infra`.
//
// The lock is the container name, per runner: two rebuilds on one machine would collide on the same
// tag, two machines would not. In bare mode the script runs detached from the clone, and a lock file
// stands in for the container name.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCKER_PROBE_MS,
  DOCKER_QUICK_MS,
  DOCKER_START_MS,
  type DockerExec,
  docker,
} from "../../shared/docker-exec.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import { done, refuse, type Refusal, type Result } from "../../http/from-result.js";
import { logControlEvent } from "../../events/control-log-store.js";
import { runnerById } from "../runner-store.js";
import {
  FLEET_MAKE_TARGETS,
  HOST_UPDATES_SUBPATH,
  UPDATER_IMAGE,
  UPDATES_DIR,
  hostPaths,
  rebuildOneImageLines,
  type FleetMakeTarget,
  type HostPaths,
  type SshRunner,
} from "../../updates/docker-update.js";
import { REBUILD_DONE_LINES, REBUILD_KO_INIT, shQuote } from "../../shared/shell.js";
import { REPO_ROOT } from "../../updates/git.js";
import { runtimeMode, type RuntimeMode } from "../../updates/stamp.js";
import {
  projectImageRebuildLines,
  projectImageTargets,
  type ProjectImageTarget,
} from "./project.js";

/** The three images, by the key the screen knows (`image`, `sharedImages[].key`). */
export const IMAGE_TARGET = { session: "session", browser: "browser", proxy: "proxy" } as const;
export type ImageTargetKey = (typeof IMAGE_TARGET)[keyof typeof IMAGE_TARGET];
export const IMAGE_TARGET_KEYS = Object.values(IMAGE_TARGET) as readonly ImageTargetKey[];

const MAKE_TARGET_OF: Record<ImageTargetKey, string> = {
  session: "image-session",
  browser: "image-browser",
  proxy: "image-proxy",
};

/** Requested `make` targets, in fleet order (the update's). */
function makeTargetsOf(keys: readonly ImageTargetKey[]): FleetMakeTarget[] {
  const wanted = new Set(keys.map((k) => MAKE_TARGET_OF[k]));
  return FLEET_MAKE_TARGETS.filter((t) => wanted.has(t.target));
}

export function rebuildContainerName(runnerId: string): string {
  return `legion-rebuild-${runnerId}`;
}

type RunnerRef = Pick<SshRunner, "name" | "dockerHost"> & { id?: string };

/** Pure; see `updaterScript` for each shared line.
 *
 *  `projectTargets` (09/09, defect 3): rebuilding `legion-session` on demand also leaves derived
 *  project images stale unless replayed. Only when `session` is requested: browser or proxy do not
 *  change the base. */
export function rebuildScript(
  runner: RunnerRef,
  keys: readonly ImageTargetKey[],
  logName: string,
  projectTargets: readonly ProjectImageTarget[] = [],
): string {
  return [
    "set -e",
    '[ -e .git ] || { echo "⛔ $PWD is not a git clone — LEGION_HOST_REPO is wrong."; exit 1; }',
    `LOG="$PWD/${HOST_UPDATES_SUBPATH}/${logName}"`,
    `mkdir -p "$PWD/${HOST_UPDATES_SUBPATH}"`,
    'exec >>"$LOG" 2>&1',
    'say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }',
    `say "Rebuilding image(s) on ${runner.name}, on request."`,
    '[ -d "$HOME/.ssh" ] && { mkdir -p /root/.ssh && cp -R "$HOME/.ssh/." /root/.ssh/ && chmod -R go-rwx /root/.ssh; }',
    'git config --global --add safe.directory "$PWD" 2>/dev/null || true',
    "command -v make >/dev/null 2>&1 || apk add --no-cache make >/dev/null 2>&1 || true",
    `RUNNER_NAME=${shQuote(runner.name)}`,
    `RUNNER_HOST=${shQuote(runner.dockerHost)}`,
    REBUILD_KO_INIT,
    ...makeTargetsOf(keys).flatMap(rebuildOneImageLines),
    ...(keys.includes(IMAGE_TARGET.session)
      ? projectTargets.flatMap(projectImageRebuildLines)
      : []),
    ...REBUILD_DONE_LINES,
  ].join("\n");
}

/** Grouped: targets and log travel together from `startImageRebuild`. */
export interface RebuildRequest {
  keys: readonly ImageTargetKey[];
  logName: string;
  projectTargets?: readonly ProjectImageTarget[];
}

/** Pure: the same mounts as `updaterArgs`, and a per-runner name. */
export function rebuildArgs(
  host: HostPaths,
  runner: RunnerRef & { id: string },
  request: RebuildRequest,
): string[] {
  return [
    "run",
    "-d",
    "--name",
    rebuildContainerName(runner.id),
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${host.repo}:${host.repo}`,
    "-v",
    `${host.home}/.ssh:${host.home}/.ssh:ro`,
    "-e",
    `HOME=${host.home}`,
    "-e",
    `LEGION_HOST_HOME=${host.home}`,
    "-w",
    host.repo,
    UPDATER_IMAGE,
    "sh",
    "-c",
    rebuildScript(runner, request.keys, request.logName, request.projectTargets ?? []),
  ];
}

export interface RebuildDeps {
  env?: NodeJS.ProcessEnv;
  exec?: DockerExec;
  mode?: RuntimeMode;
  updatesDir?: string;
  spawnFn?: typeof spawn;
}

const lockPath = (updatesDir: string, runnerId: string) =>
  join(updatesDir, `rebuild-${runnerId}.lock`);

/** One read, two facts: does it exist (a carcass holds the name), does it run (lock taken). */
async function inspectRebuildContainer(
  exec: DockerExec,
  runnerId: string,
): Promise<{ exists: boolean; running: boolean }> {
  const state = await exec(
    ["inspect", "-f", "{{.State.Running}}", rebuildContainerName(runnerId)],
    null,
    DOCKER_PROBE_MS,
  );
  return { exists: state.code === 0, running: state.code === 0 && state.stdout.trim() === "true" };
}

/** Docker mode: the named container; bare mode: the lock file the script removes on exit. */
export async function imageRebuildRunning(
  runnerId: string,
  deps: RebuildDeps = {},
): Promise<boolean> {
  const mode = deps.mode ?? runtimeMode();
  if (mode === "bare") return existsSync(lockPath(deps.updatesDir ?? UPDATES_DIR, runnerId));
  return (await inspectRebuildContainer(deps.exec ?? docker, runnerId)).running;
}

export interface RebuildStarted {
  runnerId: string;
  runnerName: string;
  targets: ImageTargetKey[];
  logPath: string;
}

/** Docker mode: check host paths, clear a carcass, launch the container. */
async function startDockerImageRebuild(
  runner: RunnerRef & { id: string },
  request: { targets: ImageTargetKey[]; logName: string },
  deps: { env?: NodeJS.ProcessEnv; exec: DockerExec },
  busy: (why: string) => Refusal,
): Promise<Result<string>> {
  const { targets, logName } = request;
  const host = hostPaths(deps.env ?? process.env);
  if (!host)
    return refuse(
      400,
      "the clone path on the host is not declared (LEGION_HOST_REPO / LEGION_HOST_HOME) — run “./deploy/up.sh” again, it sets them",
    );
  const probe = await inspectRebuildContainer(deps.exec, runner.id);
  if (probe.running)
    return busy(
      `follow it in its log, or with “docker logs -f ${rebuildContainerName(runner.id)}” on the host`,
    );
  // A stopped carcass holds the name: removed only once seen not running.
  if (probe.exists) await deps.exec(["rm", rebuildContainerName(runner.id)], null, DOCKER_QUICK_MS);
  // Read here by the control plane, never by the ephemeral container. `rebuildScript` replays them
  // only when `session` is requested.
  const run = await deps.exec(
    rebuildArgs(host, runner, { keys: targets, logName, projectTargets: projectImageTargets() }),
    null,
    DOCKER_START_MS,
  );
  if (run.code !== 0)
    return refuse(
      502,
      `the rebuild container did not start: ${(run.stderr || run.stdout).trim().slice(0, 300)}`,
    );
  return done(`${host.repo}/${HOST_UPDATES_SUBPATH}/${logName}`);
}

/** Returns immediately: the result is in the log, and in `/api/infra` once the image label matches. */
export async function startImageRebuild(
  runnerId: string,
  keys: readonly ImageTargetKey[],
  deps: RebuildDeps = {},
): Promise<Result<RebuildStarted>> {
  const runner = runnerById(runnerId);
  if (!runner) return refuse(404, "runner not found");
  if (runner.kind !== RUNNER_KIND.docker)
    return refuse(400, "this runner runs no container: it has no image to rebuild");
  const targets = [...new Set(keys)];
  if (targets.length === 0) return refuse(400, "no image requested");

  const mode = deps.mode ?? runtimeMode();
  const updatesDir = deps.updatesDir ?? UPDATES_DIR;
  const exec = deps.exec ?? docker;
  const ref = { id: runner.id, name: runner.name, dockerHost: runner.dockerHost ?? "" };
  const logName = `rebuild-${runner.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  mkdirSync(updatesDir, { recursive: true });

  const busy = (why: string) =>
    refuse(409, `a rebuild is already running on “${runner.name}” — ${why}`);

  let logPath: string;
  if (mode === "docker") {
    const started = await startDockerImageRebuild(
      ref,
      { targets, logName },
      { env: deps.env, exec },
      busy,
    );
    if (!started.ok) return started;
    logPath = started.value;
  } else {
    if (existsSync(lockPath(updatesDir, runner.id))) return busy("follow it in its log");
    logPath = startBareRebuild(
      ref,
      { targets, logName },
      { updatesDir, spawnFn: deps.spawnFn ?? spawn },
    );
  }

  logControlEvent("info", "infra", `rebuild started on “${runner.name}”: ${targets.join(", ")}`, {
    runnerId: runner.id,
    targets,
    logPath,
  });
  return done({ runnerId: runner.id, runnerName: runner.name, targets, logPath });
}

/** Bare mode: the same script from the clone, detached. The lock file is removed by the script on
 *  exit, whatever `make` does. Project images are not cascaded here. */
function startBareRebuild(
  runner: RunnerRef & { id: string },
  request: { targets: ImageTargetKey[]; logName: string },
  deps: { updatesDir: string; spawnFn: typeof spawn },
): string {
  const { targets, logName } = request;
  const { updatesDir, spawnFn } = deps;
  const logPath = join(updatesDir, logName);
  const lock = lockPath(updatesDir, runner.id);
  writeFileSync(lock, `${new Date().toISOString()}\n`);
  const fd = openSync(logPath, "a");
  // No docker preamble: the fd is already the log, we are the operator, we are in the clone.
  const script = [
    `trap 'rm -f ${shQuote(lock)}' EXIT`,
    'say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }',
    `say "Rebuilding image(s) on ${runner.name}, on request (bare mode)."`,
    `RUNNER_NAME=${shQuote(runner.name)}`,
    `RUNNER_HOST=${shQuote(runner.dockerHost)}`,
    REBUILD_KO_INIT,
    ...makeTargetsOf(targets).flatMap(rebuildOneImageLines),
    ...REBUILD_DONE_LINES,
  ].join("\n");
  try {
    const child = spawnFn("sh", ["-c", script], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
  } catch (err) {
    unlinkSync(lock);
    throw err;
  }
  return logPath;
}
