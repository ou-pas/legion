// Building a project image on a runner, on demand (09/09). `rebuild.ts` for a project: same
// ephemeral container, socket, and Legion clone at the same path (where `scripts/project-image.sh`
// and the payload files live). The project's Dockerfile is pasted in `projects.session_dockerfile`
// and passed as an argument: nothing to clone (v66 cloned the project repo on the host).
//
// The operator's `.ssh` came back on 12/09. v67 removed it with the clone, but a remote runner is a
// `DOCKER_HOST=ssh://…`, and docker's real `ssh` refuses the machine without `known_hosts`:
//
//   ssh … 100.64.0.11 docker system dial-stdio … stderr=Host key verification failed.
//
// Confusing because the control plane probed the same runner fine. Mount and copy are those of
// `rebuild.ts`, which never had the defect.
//
// The lock is the container name per (runner, project) pair: two projects may build at once on one
// machine, two clicks on one project may not.
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
import { shQuote } from "../../shared/shell.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import { done, refuse, type Refusal, type Result } from "../../http/from-result.js";
import { logControlEvent } from "../../events/control-log-store.js";
import { runnerById } from "../runner-store.js";
import { projectById } from "./project-store.js";
import {
  HOST_UPDATES_SUBPATH,
  UPDATER_IMAGE,
  UPDATES_DIR,
  hostPaths,
  type HostPaths,
} from "../../updates/docker-update.js";
import { REPO_ROOT } from "../../updates/git.js";
import { runtimeMode, type RuntimeMode } from "../../updates/stamp.js";
import { SESSION_IMAGE } from "../fleet-images.js";

function sanitizeForContainerName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-");
}

export function projectRebuildContainerName(runnerId: string, projectId: string): string {
  return `legion-rebuild-project-${sanitizeForContainerName(runnerId)}-${sanitizeForContainerName(projectId)}`;
}

type RunnerRef = { name: string; dockerHost: string };
type BuildTarget = { projectId: string; tag: string; dockerfile: string };

/** Pure; same preamble as `rebuildScript` (rebuild.ts). The Dockerfile is a single-quoted argument,
 *  newlines included. */
export function projectRebuildScript(
  runner: RunnerRef,
  target: BuildTarget,
  logName: string,
): string {
  const args = [shQuote(target.tag), shQuote(SESSION_IMAGE), shQuote(target.dockerfile)].join(" ");
  return [
    "set -e",
    '[ -e .git ] || { echo "⛔ $PWD is not a git clone — LEGION_HOST_REPO is wrong."; exit 1; }',
    `LOG="$PWD/${HOST_UPDATES_SUBPATH}/${logName}"`,
    `mkdir -p "$PWD/${HOST_UPDATES_SUBPATH}"`,
    'exec >>"$LOG" 2>&1',
    'say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }',
    `say "Building the “${target.tag}” image on ${runner.name}, on request."`,
    // Same line as `rebuildScript`: docker's `ssh` reads `/root/.ssh` (the container runs as root),
    // and the mount is read-only, hence a copy.
    '[ -d "$HOME/.ssh" ] && { mkdir -p /root/.ssh && cp -R "$HOME/.ssh/." /root/.ssh/ && chmod -R go-rwx /root/.ssh; }',
    `DOCKER_HOST=${shQuote(runner.dockerHost)} sh scripts/project-image.sh build ${args}`,
    'say "✓ done."',
  ].join("\n");
}

/** Runner, target and log travel together, like `RebuildRequest` (rebuild.ts). */
export interface ProjectRebuildRequest {
  runnerId: string;
  target: BuildTarget;
  logName: string;
}

/** Pure; same mounts as `rebuildArgs` (rebuild.ts). `.ssh` is there to REACH a remote runner
 *  (`known_hosts` and key), read-only, copied by the script. */
export function projectRebuildArgs(
  host: HostPaths,
  runner: RunnerRef,
  request: ProjectRebuildRequest,
): string[] {
  return [
    "run",
    "-d",
    "--name",
    projectRebuildContainerName(request.runnerId, request.target.projectId),
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${host.repo}:${host.repo}`,
    "-v",
    `${host.home}/.ssh:${host.home}/.ssh:ro`,
    "-e",
    `HOME=${host.home}`,
    "-w",
    host.repo,
    UPDATER_IMAGE,
    "sh",
    "-c",
    projectRebuildScript(runner, request.target, request.logName),
  ];
}

export interface ProjectRebuildDeps {
  env?: NodeJS.ProcessEnv;
  exec?: DockerExec;
  mode?: RuntimeMode;
  updatesDir?: string;
  spawnFn?: typeof spawn;
}

const lockPath = (updatesDir: string, runnerId: string, projectId: string) =>
  join(updatesDir, `rebuild-project-${runnerId}-${projectId}.lock`);

async function inspectRebuildContainer(
  exec: DockerExec,
  runnerId: string,
  projectId: string,
): Promise<{ exists: boolean; running: boolean }> {
  const state = await exec(
    ["inspect", "-f", "{{.State.Running}}", projectRebuildContainerName(runnerId, projectId)],
    null,
    DOCKER_PROBE_MS,
  );
  return { exists: state.code === 0, running: state.code === 0 && state.stdout.trim() === "true" };
}

/** Same shape as `imageRebuildRunning` (rebuild.ts). */
export async function projectImageRebuildRunning(
  runnerId: string,
  projectId: string,
  deps: ProjectRebuildDeps = {},
): Promise<boolean> {
  const mode = deps.mode ?? runtimeMode();
  if (mode === "bare")
    return existsSync(lockPath(deps.updatesDir ?? UPDATES_DIR, runnerId, projectId));
  return (await inspectRebuildContainer(deps.exec ?? docker, runnerId, projectId)).running;
}

export interface ProjectRebuildStarted {
  runnerId: string;
  runnerName: string;
  projectId: string;
  tag: string;
  logPath: string;
}

/** Docker mode, split out like `startDockerImageRebuild` (rebuild.ts). */
async function startDockerProjectImageRebuild(
  runner: RunnerRef,
  request: ProjectRebuildRequest,
  deps: { env?: NodeJS.ProcessEnv; exec: DockerExec },
  busy: (why: string) => Refusal,
): Promise<Result<string>> {
  const { runnerId, target, logName } = request;
  const host = hostPaths(deps.env ?? process.env);
  if (!host)
    return refuse(
      400,
      "the clone path on the host is not declared (LEGION_HOST_REPO / LEGION_HOST_HOME) — run “./deploy/up.sh” again, it sets them",
    );
  const probe = await inspectRebuildContainer(deps.exec, runnerId, target.projectId);
  if (probe.running)
    return busy(
      `follow it in its log, or with “docker logs -f ${projectRebuildContainerName(runnerId, target.projectId)}” on the host`,
    );
  if (probe.exists)
    await deps.exec(
      ["rm", projectRebuildContainerName(runnerId, target.projectId)],
      null,
      DOCKER_QUICK_MS,
    );
  const run = await deps.exec(
    projectRebuildArgs(host, runner, { runnerId, target, logName }),
    null,
    DOCKER_START_MS,
  );
  if (run.code !== 0)
    return refuse(
      502,
      `the build container did not start: ${(run.stderr || run.stdout).trim().slice(0, 300)}`,
    );
  return done(`${host.repo}/${HOST_UPDATES_SUBPATH}/${logName}`);
}

/** The project validated for building: exists, tagged, Dockerfile declared. */
function resolvedProjectTarget(
  projectId: string,
): Result<{ target: BuildTarget; projectName: string }> {
  const project = projectById(projectId);
  if (!project) return refuse(404, "project not found");
  const tag = project.sessionImage?.trim();
  if (!tag) return refuse(400, "this project declares no session image of its own");
  const dockerfile = project.sessionDockerfile?.trim();
  if (!dockerfile) return refuse(400, "this project declares no Dockerfile — nothing to build");
  return done({ target: { projectId, tag, dockerfile }, projectName: project.name });
}

/** Returns immediately: the result is in the log, and in the image state (`project.ts`) once the
 *  label matches. */
export async function startProjectImageRebuild(
  projectId: string,
  runnerId: string,
  deps: ProjectRebuildDeps = {},
): Promise<Result<ProjectRebuildStarted>> {
  const runner = runnerById(runnerId);
  if (!runner) return refuse(404, "runner not found");
  if (runner.kind !== RUNNER_KIND.docker)
    return refuse(400, "this runner runs no container: it has no image to rebuild");

  const resolved = resolvedProjectTarget(projectId);
  if (!resolved.ok) return resolved;
  const { target, projectName } = resolved.value;
  const { tag } = target;

  const mode = deps.mode ?? runtimeMode();
  const updatesDir = deps.updatesDir ?? UPDATES_DIR;
  const exec = deps.exec ?? docker;
  const ref = { name: runner.name, dockerHost: runner.dockerHost ?? "" };
  const logName = `rebuild-project-${runner.id}-${projectId}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  mkdirSync(updatesDir, { recursive: true });

  const busy = (why: string) =>
    refuse(409, `a build is already running for “${projectName}” on “${runner.name}” — ${why}`);

  let logPath: string;
  if (mode === "docker") {
    const started = await startDockerProjectImageRebuild(
      ref,
      { runnerId: runner.id, target, logName },
      { env: deps.env, exec },
      busy,
    );
    if (!started.ok) return started;
    logPath = started.value;
  } else {
    if (existsSync(lockPath(updatesDir, runner.id, projectId))) return busy("follow it in its log");
    logPath = startBareRebuild(
      ref,
      { runnerId: runner.id, target, logName },
      {
        updatesDir,
        spawnFn: deps.spawnFn ?? spawn,
      },
    );
  }

  logControlEvent("info", "infra", `image build started for “${projectName}” on “${runner.name}”`, {
    runnerId: runner.id,
    projectId,
    tag,
    logPath,
  });
  return done({ runnerId: runner.id, runnerName: runner.name, projectId, tag, logPath });
}

/** Bare mode: same script, detached, like `startBareRebuild` (rebuild.ts). */
function startBareRebuild(
  runner: RunnerRef,
  request: ProjectRebuildRequest,
  deps: { updatesDir: string; spawnFn: typeof spawn },
): string {
  const { runnerId, target, logName } = request;
  const { updatesDir, spawnFn } = deps;
  const logPath = join(updatesDir, logName);
  const lock = lockPath(updatesDir, runnerId, target.projectId);
  writeFileSync(lock, `${new Date().toISOString()}\n`);
  const fd = openSync(logPath, "a");
  const args = [shQuote(target.tag), shQuote(SESSION_IMAGE), shQuote(target.dockerfile)].join(" ");
  const script = [
    `trap 'rm -f ${shQuote(lock)}' EXIT`,
    'say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }',
    `say "Building the “${target.tag}” image on ${runner.name}, on request (bare mode)."`,
    `DOCKER_HOST=${shQuote(runner.dockerHost)} sh scripts/project-image.sh build ${args}`,
    'say "✓ done."',
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
