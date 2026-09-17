// Docker mode: an ephemeral, detached container (01/09, slice 08).
//
// Same problem as bare mode, same shape: `docker compose up -d --build` destroys the control plane
// container, so a detached container outlives it, literally `spawn(detached)` replaced by
// `docker run -d`.
//
// What the ephemeral container mounts, and why:
//  · the host's Docker socket, to rebuild and restart the control plane (a root-equivalent grant,
//    recorded in produit/decisions.md);
//  · the host clone at the SAME absolute path as on the host: `compose.yaml` uses relative mounts
//    (`../server/data`) resolved on the host, and mounting on `/repo` would start a control plane
//    on an empty database with nobody seeing why;
//  · the operator's `~/.ssh`, read-only: the repository is private and `git fetch` needs the key.
// And `HOME`: `compose.yaml` interpolates `${HOME}/.ssh/…`; from the ephemeral container it would
// be `/root`, so the operator's HOME is passed back (`LEGION_HOST_HOME`).
//
// The lock is the container name: Docker refuses two containers with one name, atomically, and the
// lock survives the control plane restart that is at stake. A stopped carcass is removed only once
// verified stopped; a blind `rm -f` would kill the update in progress.
//
// Fleet images are rebuilt here too (02/09 session image, 03/09 the other two), on every docker
// runner, remote or local (v65), where sessions actually run. Without it each update touching
// `runner-payload/` left the fleet stale until someone ran the command by hand on each Mac.
//
// After `./deploy/up.sh`, never before: the new control plane must be alive during the 2 to 4
// minute remote rebuilds. The runner list is read before launching (`activeSshRunners`) and baked
// into the script, since the ephemeral container has no database.
//
// A failure per runner and image does not fail the update (a sleeping Mac is not an outage): each
// attempt is an `if`, which `set -e` never trips on, so the log names the image and machine and
// the loop goes on.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { allRunners } from "./updates-store.js";
import { REPO_ROOT } from "./git.js";
import {
  DOCKER_PROBE_MS,
  DOCKER_QUICK_MS,
  DOCKER_START_MS,
  type DockerExec,
  docker,
} from "../shared/docker-exec.js";
import { sshTargetOf } from "../shared/ssh-target.js";
import { RUNNER_KIND } from "../shared/enums.js";
import { REBUILD_DONE_LINES, REBUILD_KO_INIT, REBUILD_KO_ONE, shQuote } from "../shared/shell.js";
// `infra/images/rebuild.ts` imports this file; no cycle, since `infra/images/project.ts` imports
// nothing from here.
import { type ProjectImageTarget, projectImageRebuildLines } from "../infra/images/project.js";

/** The name IS the lock, hence fixed. */
export const UPDATE_CONTAINER = "legion-update";

/** The image `deploy/Dockerfile` already takes its docker CLI from. Measured 01/09: it has `git`,
 *  `ssh` and the `compose` plugin, so nothing to install at the worst moment to depend on network. */
export const UPDATER_IMAGE = "docker:28-cli";

/** Where the ephemeral container writes the log, from the clone. Same file the control plane sees
 *  under `LEGION_DATA`, mounted elsewhere. */
export const HOST_UPDATES_SUBPATH = "server/data/updates";

/** The same folder seen from the control plane. One owner: three modules used to recompute it. */
export const UPDATES_DIR = join(
  process.env.LEGION_DATA ?? join(REPO_ROOT, "server", "data"),
  "updates",
);

/** What `compose.yaml` must have told the control plane. */
export interface HostPaths {
  /** The clone path ON THE HOST (`LEGION_HOST_REPO`). */
  repo: string;
  /** The operator's HOME ON THE HOST (`LEGION_HOST_HOME`). */
  home: string;
}

/** `null` when `compose.yaml` did not set them: never guessed, a wrong path runs `git fetch` in a
 *  random folder. */
export function hostPaths(env: NodeJS.ProcessEnv): HostPaths | null {
  const repo = (env.LEGION_HOST_REPO ?? "").trim();
  const home = (env.LEGION_HOST_HOME ?? "").trim();
  return repo && home ? { repo, home } : null;
}

/** A tag entering a shell line. `parseVersion` already constrains it; this is the belt, since the
 *  list comes from the GitHub API and a mistake means arbitrary execution next to the socket. */
const SAFE_TAG = /^[A-Za-z0-9._-]+$/;

/** Just enough to run `DOCKER_HOST=<host> make image-session` and name the step in the log. An
 *  empty `dockerHost` means the host's own daemon. */
export interface SshRunner {
  name: string;
  dockerHost: string;
}

/** Enabled docker runners, same filter as the probe and the orphan volume sweep
 *  (`enabled && kind === docker`), restricted to `ssh://` or the local socket; `tcp://` is out.
 *  Read here, by the control plane about to die, not by the ephemeral container. */
export function activeSshRunners(): SshRunner[] {
  return allRunners()
    .filter(
      (r) =>
        r.kind === RUNNER_KIND.docker &&
        r.enabled &&
        // v65: the local daemon counts too. It used to be filtered out, so its session image was
        // never rebuilt (04/09: sessions dying at boot on an old payload, only `exit 1`). The
        // update container carries the host socket, so an empty `DOCKER_HOST` is this daemon.
        (!r.dockerHost || sshTargetOf(r.dockerHost)),
    )
    .map((r) => ({ name: r.name, dockerHost: r.dockerHost ?? "" }));
}

// Re-exported since `shQuote` moved to `shared/shell.ts` (09/09), for existing importers.
export { shQuote };

/** The three fleet images, in replay order (03/09).
 *
 *  Only the first used to be rebuilt, so a merged and tagged `browser-image/` fix never deployed:
 *  the 03/09 outage, a Playwright 1.49 browser service against a 1.62 repo, `chromium.connect()`
 *  refusing the handshake, half an hour lost on an unrelated-looking symptom.
 *
 *  Free when nothing changed: `image-browser` and `image-proxy` compare their context hash with the
 *  label on the target daemon's image (`scripts/fleet-image.sh`) and return at once, instead of
 *  downloading gigabytes on every Mac. `image-session` always rebuilds: it changes almost every
 *  update. */
export interface FleetMakeTarget {
  target: string;
  label: string;
}
export const FLEET_MAKE_TARGETS: readonly FleetMakeTarget[] = [
  { target: "image-session", label: "session image" },
  { target: "image-browser", label: "browser image" },
  { target: "image-proxy", label: "proxy image" },
];

/** Inserted AFTER `./deploy/up.sh`. Each (runner, image) pair is an `if`, so a failing one logs
 *  and lets the next try.
 *
 *  `projectTargets` (09/09, defect 3): project images are built on top of `image-session`, which
 *  changes every update, so they must be replayed right after or stay stale forever. Empty by
 *  default; `startUpdate` passes the real list. */
function rebuildFleetImagesOnRunners(
  runners: SshRunner[],
  projectTargets: ProjectImageTarget[] = [],
): string[] {
  if (runners.length === 0)
    return ['say "— fleet images: no active ssh:// runner, nothing to rebuild remotely"'];
  const lines = [
    `say "— fleet images: rebuilding on ${runners.length} ssh:// runner(s) (~2 to 4 min each; browser and proxy only if their context changed)"`,
    // `docker:28-cli` has git, ssh and compose but `make` was never verified: install it if needed.
    // If `apk` is offline too, the loop logs each runner's failure without stopping the update.
    "command -v make >/dev/null 2>&1 || apk add --no-cache make >/dev/null 2>&1 || true",
  ];
  for (const r of runners) {
    // Through variables rather than inline literals: a double-quoted `$RUNNER_NAME` is never
    // re-evaluated, so a runner name needs no character allowlist, whereas an inline literal in
    // `say` would be read by the shell a second time.
    lines.push(`RUNNER_NAME=${shQuote(r.name)}`, `RUNNER_HOST=${shQuote(r.dockerHost)}`);
    for (const img of FLEET_MAKE_TARGETS) lines.push(...rebuildOneImageLines(img));
    // After `image-session`: each project image is built on it, and its hash compares with what was
    // just rebuilt on this runner.
    for (const t of projectTargets) lines.push(...projectImageRebuildLines(t));
  }
  return lines;
}

/** One image on the runner named by `$RUNNER_NAME` / `$RUNNER_HOST`. Shared with the on-demand
 *  rebuild (07/09, `infra/images/rebuild.ts`), so the Infra card button replays exactly this. */
export function rebuildOneImageLines(img: FleetMakeTarget): string[] {
  return [
    `say "  → ${img.label} on $RUNNER_NAME ($RUNNER_HOST)"`,
    // `SHELL=/bin/sh`: the Makefile declares bash, but `docker:28-cli` is Alpine without it; both
    // runners failed with "/bin/bash: No such file or directory" on v0.7.1 (02/09). The recipes
    // are POSIX sh.
    `if DOCKER_HOST="$RUNNER_HOST" make SHELL=/bin/sh ${img.target}; then`,
    `  say "  ✓ $RUNNER_NAME: ${img.label} up to date"`,
    "else",
    `  ${REBUILD_KO_ONE}`,
    `  say "  ⛔ $RUNNER_NAME: ${img.label} — rebuild failed, no consequence for this update; “Rebuild here” on the Infra card replays exactly this gesture"`,
    "fi",
  ];
}

/** Which tag, which log, which fleet: they travel together from click to `docker run`. */
export interface UpdateRun {
  target: string;
  logName: string;
  /** Empty by default; see `startDockerUpdate`. */
  runners?: SshRunner[];
  projectTargets?: ProjectImageTarget[];
}

/** The host: its env (clone paths), the control plane's log folder, and the docker daemon. */
export interface DockerUpdateHost {
  env: NodeJS.ProcessEnv;
  updatesDir: string;
  exec?: DockerExec;
}

/**
 * The whole script. Pure: the only way to pin a command line no test can run. No host path is
 * interpolated (`$PWD` is the clone, via `-w <clone>`).
 *
 * `reset --hard <tag>`, not `checkout <tag>` as in bare mode: a tag checkout leaves the server clone
 * detached, so the next update would find `branch: null` and refuse.
 *
 * Not `merge --ff-only` either, used until 14/09: after a history rewrite (repo authors rewritten
 * that day) every sha changed, `fatal: refusing to merge unrelated histories`, and a manual reset
 * over SSH was needed. `ff-only` only protects local commits, which a deployment clone never has.
 * A deployment clone is a mirror: it is reset, not merged.
 *
 * A receipt remains: what the reset will discard is logged first. Not a guard, a trace.
 */
export function updaterScript(run: UpdateRun): string {
  const { target, logName, runners = [], projectTargets = [] } = run;
  if (!SAFE_TAG.test(target)) throw new Error(`tag refused: ${target}`);
  return [
    "set -e",
    // Before the log, which would otherwise land in the wrong place: a wrong `LEGION_HOST_REPO`
    // would create random folders on the host. The message goes to `docker logs`.
    '[ -e .git ] || { echo "⛔ $PWD is not a git clone — LEGION_HOST_REPO is wrong."; exit 1; }',
    `LOG="$PWD/${HOST_UPDATES_SUBPATH}/${logName}"`,
    `mkdir -p "$PWD/${HOST_UPDATES_SUBPATH}"`,
    'exec >>"$LOG" 2>&1',
    'say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }',
    `say "Updating to ${target} (Docker mode, container ${UPDATE_CONTAINER})."`,
    // The operator's `.ssh` is copied, not read in place: OpenSSH resolves `~` from the user table,
    // so root reads `/root/.ssh` whatever `$HOME` says (01/09, second real click: the
    // `github-legion` alias never read, "Could not resolve hostname"). Mounting onto `/root/.ssh`
    // fails with "Bad owner or permissions". The copy dies with the container.
    // No `export HOME=/root` (02/09, third click): compose interpolates `${HOME}/.ssh/…`, so the new
    // control plane would get root's missing key and every ssh:// runner would go unreachable after
    // a successful update.
    '[ -d "$HOME/.ssh" ] && { mkdir -p /root/.ssh && cp -R "$HOME/.ssh/." /root/.ssh/ && chmod -R go-rwx /root/.ssh; }',
    // The container is root, the clone belongs to the operator: without this git refuses everything
    // ("detected dubious ownership", exit 128). Same class as the session image's `safe.directory`
    // (30/08). Global to the ephemeral container only.
    'git config --global --add safe.directory "$PWD"',
    'say "— starting point: $(git rev-parse --short HEAD)"',
    'say "— fetching tags"',
    // `--force` because a tag can move: otherwise "would clobber existing tag", exit 1, and `set -e`
    // kills the update (13/09, after a history rewrite moved four tags). A deployment clone has no
    // tags to defend.
    "git fetch --tags --prune --force",
    `say "— resetting to ${target}"`,
    // The receipt: silent on a clean clone, talkative exactly when it matters.
    'DIRTY=$(git status --porcelain); [ -z "$DIRTY" ] || say "— discarded by the reset: $DIRTY"',
    `git reset --hard ${target}`,
    'say "— rebuild and restart (the control plane dies here, this log goes on)"',
    "./deploy/up.sh",
    REBUILD_KO_INIT,
    ...rebuildFleetImagesOnRunners(runners, projectTargets),
    ...REBUILD_DONE_LINES,
  ].join("\n");
}

/** The exact `docker run` arguments. Pure, like the script. */
export function updaterArgs(host: HostPaths, run: UpdateRun): string[] {
  return [
    "run",
    "-d",
    "--name",
    UPDATE_CONTAINER,
    // The HOST's daemon, never a runner's: this control plane is what gets replaced.
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    // Same absolute path as on the host, so `compose.yaml`'s relative mounts resolve.
    "-v",
    `${host.repo}:${host.repo}`,
    "-v",
    `${host.home}/.ssh:${host.home}/.ssh:ro`,
    "-e",
    `HOME=${host.home}`,
    // Explicit, besides HOME: `up.sh` prefers an inherited `LEGION_HOST_HOME`, and the image's
    // metadata sets `HOME=/root`. Two clicks out of three failed on that implicit chain.
    "-e",
    `LEGION_HOST_HOME=${host.home}`,
    "-w",
    host.repo,
    UPDATER_IMAGE,
    "sh",
    "-c",
    updaterScript(run),
  ];
}

/** Where the operator reads the log on the host; same file as `LEGION_DATA/updates`. */
export function hostLogPath(host: HostPaths, logName: string): string {
  return `${host.repo}/${HOST_UPDATES_SUBPATH}/${logName}`;
}

export interface DockerUpdateResult {
  logPath: string;
  target: string;
}

/** The lock. `inspect` returns 0 if the container exists in any state; `running` says whether it
 *  still runs. Shared by the double-launch refusal and `dockerUpdateRunning` (02/09). */
async function inspectUpdateContainer(
  exec: DockerExec,
): Promise<{ exists: boolean; running: boolean }> {
  const state = await exec(
    ["inspect", "-f", "{{.State.Running}}", UPDATE_CONTAINER],
    null,
    DOCKER_PROBE_MS,
  );
  return { exists: state.code === 0, running: state.code === 0 && state.stdout.trim() === "true" };
}

/** What `/api/version` reads for `updating: true`. */
export async function dockerUpdateRunning(exec: DockerExec = docker): Promise<boolean> {
  return (await inspectUpdateContainer(exec)).running;
}

/**
 * Launches the container and returns: this process will be destroyed by what it just launched.
 *
 * `runners` defaults to `[]`, not `activeSshRunners()`, so this stays testable without a database;
 * `startUpdate` (`updates.ts`) queries it and passes the list.
 */
export async function startDockerUpdate(
  run: UpdateRun,
  on: DockerUpdateHost,
): Promise<DockerUpdateResult> {
  const { env, updatesDir, exec = docker } = on;
  const host = hostPaths(env);
  if (!host)
    throw new Error(
      "the clone path on the host is not declared (LEGION_HOST_REPO / LEGION_HOST_HOME)." +
        " Run the install again with “./deploy/up.sh”, which sets them.",
    );

  const probe = await inspectUpdateContainer(exec);
  if (probe.running)
    throw new Error(
      `an update is already running (container ${UPDATE_CONTAINER}).` +
        ` Follow it in the log, or with “docker logs -f ${UPDATE_CONTAINER}” on the host.`,
    );
  // A stopped carcass would hold the name ("name already in use"); removed only now that it is
  // known not to run.
  if (probe.exists) await exec(["rm", UPDATE_CONTAINER], null, DOCKER_QUICK_MS);

  // Created by the control plane, not the root ephemeral container, or the operator could not
  // empty it.
  mkdirSync(updatesDir, { recursive: true });

  const started = await exec(updaterArgs(host, run), null, DOCKER_START_MS);
  if (started.code !== 0)
    throw new Error(
      `the update container did not start: ${(started.stderr || started.stdout).trim().slice(0, 300)}`,
    );

  return { logPath: hostLogPath(host, run.logName), target: run.target };
}
