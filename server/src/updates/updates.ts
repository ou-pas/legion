// The control plane updating itself (26/08, operator's request: check GitHub tags regularly and
// show an update button).
//
// The core problem: the process applying the update is the one being replaced. `git checkout`
// changes `server/src`, `tsx watch` restarts the server in the middle of the `pnpm install`.
//
// Hence a detached script: the control plane launches it and lets go. It outlives the server and
// writes a log file, the only witness, since the screen that would show an error is the one dying.
//
// Backing up the database comes first, before `fetch`: migrations are `PRAGMA user_version` blocks
// with no rollback, so the backup is the only way back.
//
// Two modes since 01/09, told apart by one fact: `.git` present or not. Bare mode is the above.
// Docker mode reads the version stamped in the image (`stamp.ts`) and hands the job to an ephemeral
// container (`docker-update.ts`), which is to the container what the detached script is to the
// process.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { logControlEvent } from "../events/control-log-store.js";
import { OCCUPYING_STATUSES } from "../infra/runner/limits.js";
import { occupyingSessionIds } from "./updates-store.js";
import {
  commitsBetween,
  fetchTags,
  readLocalGit,
  REPO_ROOT,
  type LocalGit,
  type TagsResult,
} from "./git.js";
import { newerThan } from "./semver.js";
import { blockerReason, updateBlocker, type UpdateBlocker } from "./guards.js";
import { markSuspendedByUpdate, suspendActiveSessions, type Suspension } from "./graceful.js";
import { NOTIF_EVENT, notifyOut } from "../notifications/notify.js";
import { runtimeMode, stampedGit, type RuntimeMode, type StampedGit } from "./stamp.js";
import {
  activeSshRunners,
  dockerUpdateRunning,
  startDockerUpdate,
  UPDATES_DIR,
  type SshRunner,
} from "./docker-update.js";
import { projectImageTargets, type ProjectImageTarget } from "../infra/images/project.js";
import { bareUpdateRunning } from "./bare-lock.js";
import { type DockerExec, docker } from "../shared/docker-exec.js";

export interface VersionState {
  /** The tag on HEAD, or `null`. */
  current: string | null;
  /** The last reachable tag, used for comparison rather than `current`: otherwise an untagged HEAD
   *  thinks it has no version and accepts going backwards. */
  lastTag: string | null;
  /** Commits between `lastTag` and HEAD; positive means unreleased code is running. */
  ahead: number;
  branch: string | null;
  sha: string;
  dirty: boolean;
  /** `null`: nothing newer, or could not ask. */
  target: string | null;
  /** Commit subjects in between, when known locally. */
  commits: string[];
  reachable: boolean;
  activeSessions: number;
  blocker: UpdateBlocker;
  reason: string | null;
  /** Why the comparison failed; `null` when it succeeded. */
  checkError: "unreachable" | "unauthorized" | "not-found" | "no-slug" | null;
  /** An update is running right now (02/09): the `legion-update` container in Docker mode, the
   *  unclosed log in bare mode. The global signal behind the pulsing badge, alive as long as the
   *  update, not only while the Version panel is mounted. A `fetch` failing during an update does not
   *  reset it: it just does not answer, and the screen keeps the last known state. */
  updating: boolean;
  /** Shown on screen: both modes update differently. */
  mode: RuntimeMode;
}

/** Also read by the resume of suspended sessions (08/09), which must restart containers only once
 *  the update is REALLY finished, fleet images included: `updaterScript` rebuilds them after
 *  `up.sh`, while the new control plane is already up (the 04/09 outage, see `docker-update.ts`).
 *
 *  In Docker mode the ephemeral container lives exactly as long as the script, so an updater dying
 *  midway frees the signal. */
export async function updateInFlight(mode: RuntimeMode, deps: VersionDeps = {}): Promise<boolean> {
  return mode === "docker"
    ? await dockerUpdateRunning(deps.exec ?? docker)
    : bareUpdateRunning(deps.updatesDir ?? UPDATES_DIR);
}

function activeSessions(): number {
  return occupyingSessionIds(OCCUPYING_STATUSES).length;
}

/** Defaults are production; a test replacing them needs no git, network or built image. */
export interface VersionDeps {
  mode?: RuntimeMode;
  env?: NodeJS.ProcessEnv;
  /** Bare mode only. */
  local?: () => Promise<LocalGit>;
  tags?: (slug: string) => Promise<TagsResult>;
  /** Injected: it reads the database, and a refusal test must not depend on what another left. */
  sessions?: () => number;
  /** Reads `updating` in Docker mode; the same executor as `startDockerUpdate`. */
  exec?: DockerExec;
  /** Reads `updating` in bare mode without depending on `LEGION_DATA`. */
  updatesDir?: string;
}

/** The only read fork: the clone in bare mode, the stamped build in Docker mode. Everything after
 *  is shared on purpose, so comparison, guards and messages do not exist twice and diverge. */
async function localGitOf(mode: RuntimeMode, deps: VersionDeps): Promise<StampedGit> {
  return mode === "docker"
    ? stampedGit(deps.env ?? process.env)
    : { ...(await (deps.local ?? readLocalGit)()), stamped: true };
}

/** Target tag and the commits leading to it.
 *
 *  Compared to `lastTag` when HEAD has no tag: an untagged HEAD is ahead of its last tag, and
 *  comparing to `null` offered a checkout backwards.
 *
 *  Commit subjects only exist in a clone; in Docker mode `spawn("git")` would fail with ENOENT for
 *  the same `[]`. */
async function forgeComparison(
  local: StampedGit,
  mode: RuntimeMode,
  deps: VersionDeps,
): Promise<{ tags: TagsResult; next: { tag: string } | null; commits: string[] }> {
  const fetchTagsFor = deps.tags ?? fetchTags;
  const tags = local.slug
    ? await fetchTagsFor(local.slug)
    : ({ ok: false, why: "no-slug" } as const);
  const next = tags.ok ? newerThan(local.tag ?? local.lastTag, tags.tags) : null;
  const commits = next && mode === "bare" ? await commitsBetween(next.tag) : [];
  return { tags, next, commits };
}

/** One source for the screen and the applying route, or the button shows where the action refuses. */
export async function versionState(deps: VersionDeps = {}): Promise<VersionState> {
  const mode = deps.mode ?? runtimeMode();
  const local = await localGitOf(mode, deps);
  const { tags, next, commits } = await forgeComparison(local, mode, deps);
  const reachable = tags.ok;
  // Same fork as the git read; neither side writes anything.
  const updating = await updateInFlight(mode, deps);
  const state = {
    activeSessions: (deps.sessions ?? activeSessions)(),
    dirty: local.dirty,
    branch: local.branch,
    target: next?.tag ?? null,
    reachable,
    stamped: local.stamped,
  };
  const blocker = updateBlocker(state);
  return {
    current: local.tag,
    lastTag: local.lastTag,
    ahead: local.ahead,
    branch: local.branch,
    sha: local.sha,
    dirty: local.dirty,
    target: state.target,
    commits,
    reachable,
    activeSessions: state.activeSessions,
    // When the comparison failed, that is the reason: a blocker on an action with no target would
    // put the consequence before the cause (lot 90 did, and its diagnostics never showed while a
    // session ran). One exception, `unstamped`: the missing slug is then a consequence of the image
    // built without its ARGs, not a property of the repository.
    blocker,
    reason: blocker === "unstamped" || tags.ok ? blockerReason(blocker, state) : checkReason(tags),
    checkError: tags.ok ? null : tags.why,
    updating,
    mode,
  };
}

/** "GitHub unreachable" on a private repo was a false diagnosis: the token was missing. */
function checkReason(tags: Awaited<ReturnType<typeof fetchTags>>): string | null {
  if (tags.ok) return null;
  switch (tags.why) {
    case "not-found":
      return "GitHub answers “repository not found”. That is also what it answers for a PRIVATE repository without a valid token: add a GITHUB_TOKEN secret to the project that declares this repository, with read access.";
    case "unauthorized":
      return "GitHub refuses this project's GITHUB_TOKEN: it has expired, or it has no read access to this repository.";
    case "no-slug":
      return "The origin of this clone is not a GitHub repository: there is nothing to compare.";
    default:
      return "GitHub did not answer. Try again, or check the connection.";
  }
}

export interface UpdateStarted {
  logPath: string;
  target: string;
}

/** Same reasons as `VersionDeps`. */
export interface StartDeps {
  version?: VersionDeps;
  exec?: DockerExec;
  spawnFn?: typeof spawn;
  env?: NodeJS.ProcessEnv;
  /** Fleet to rebuild, Docker mode only. Production: `activeSshRunners()`, read here, not in the
   *  ephemeral container (see `docker-update.ts`). */
  runners?: () => SshRunner[];
  /** Project images to replay after `image-session` on each runner (09/09). Production:
   *  `projectImageTargets()`. */
  projectTargets?: () => ProjectImageTarget[];
  /** Graceful update opt-in (08/09): suspend active sessions first. Comes from the request body,
   *  since the operator chooses it. */
  suspendSessions?: boolean;
  /** Injected for tests. */
  suspend?: () => Promise<Suspension>;
  mark?: (sessionIds: string[]) => number;
}

/**
 * Starts the update and returns: what was launched outlives this process.
 *
 * The refusal is checked here, not only on screen, which may lag a session that just started. Both
 * modes go through it, so the fork comes after.
 */
export async function startUpdate(deps: StartDeps = {}): Promise<UpdateStarted> {
  const state = await versionState(deps.version);
  // The only blocker an action can lift, and only when asked (08/09). Without the explicit opt-in a
  // neutral "Update" button would stop agents mid-work. The other blockers cannot be resolved from
  // here.
  if (state.blocker === "sessions" && deps.suspendSessions) {
    const suspension = await (deps.suspend ?? suspendActiveSessions)();
    if (!suspension.ok)
      throw new Error(
        `${suspension.stillRunning.length} session(s) did not stop in time — their turn may be a long one. Try again, or stop them by hand.`,
      );
    // An imposed pause is announced once (14/09, operator's request: notify system pauses only).
    // Marked entries are counted, not suspended sessions: one that finished on its own has no open
    // entry, and announcing a suspension that did not happen wears out the notification.
    const suspended = (deps.mark ?? markSuspendedByUpdate)(suspension.suspended);
    if (suspended > 0)
      notifyOut(NOTIF_EVENT.systemPause, {
        cause: "update",
        count: suspended,
        version: state.target,
      });
    // Reread after waiting: minutes may have passed and another blocker appeared.
    const after = await versionState(deps.version);
    if (after.blocker) throw new Error(after.reason ?? "update impossible");
    if (!after.target) throw new Error("no newer version");
    return await launch(after, deps);
  }
  if (state.blocker) throw new Error(state.reason ?? "update impossible");
  if (!state.target) throw new Error("no newer version");
  return await launch(state, deps);
}

/** Shared by both paths, with or without suspension. */
async function launch(
  state: Awaited<ReturnType<typeof versionState>>,
  deps: StartDeps,
): Promise<UpdateStarted> {
  const target = state.target as string;

  const logName = `${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  const started =
    state.mode === "docker"
      ? await startDockerUpdate(
          {
            target,
            logName,
            runners: (deps.runners ?? activeSshRunners)(),
            projectTargets: (deps.projectTargets ?? projectImageTargets)(),
          },
          { env: deps.env ?? process.env, updatesDir: UPDATES_DIR, exec: deps.exec ?? docker },
        )
      : startBareUpdate(target, logName, deps.spawnFn ?? spawn);

  logControlEvent("info", "update", `update started to ${target} (${state.mode} mode)`, {
    logPath: started.logPath,
  });
  return started;
}

/** Bare mode: detached `spawn` of a script that outlives the server `tsx watch` will kill.
 *  `spawnFn` exists so a test can pin the arguments. */
function startBareUpdate(target: string, logName: string, spawnFn: typeof spawn): UpdateStarted {
  mkdirSync(UPDATES_DIR, { recursive: true });
  const logPath = join(UPDATES_DIR, logName);
  const fd = openSync(logPath, "a");

  const script = join(REPO_ROOT, "scripts", "self-update.ts");
  if (!existsSync(script)) throw new Error(`update script not found: ${script}`);

  // `detached` + `unref`: the script is no longer our child and survives `tsx watch` killing us.
  // `--import tsx` (09/09): the script is TypeScript, run through the root's `tsx` loader.
  const child = spawnFn(process.execPath, ["--import", "tsx", script, target], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, LEGION_UPDATE_TARGET: target },
  });
  child.unref();

  return { logPath, target };
}
