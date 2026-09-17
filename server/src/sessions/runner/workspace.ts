// What survives a pause (D13 + D14 of /artifacts/rtQLldYSm2/spec.md).
//
// A `waiting` session has no container: the pause DESTROYS the runtime, and that invariant stays
// (lifecycle.ts, `runLifecycle`). What went with it was `node_modules`, the package store and any
// file git does not track; git work was already safe (the payload commits and pushes before
// exiting). Each wake-up re-cloned a 3.5 MB repository and reinstalled 640 MB of dependencies, at
// every interview round.
//
// Two mounts answer that, and the operator's point is that it takes BOTH:
//
//  · D13: `/workspace`, ONE PER SESSION, modelled on `/claude-state` (a host folder under
//    `LEGION_DATA`, bind-mounted, surviving `docker rm`). It keeps what is expensive without
//    touching the "waiting = no container" invariant.
//  · D14: the package cache, SHARED by all sessions. It addresses the same pain on the FIRST run,
//    where a kept workspace does nothing: without it the first session of a series downloads
//    everything again, since the store lived in the container's HOME (session-image/Dockerfile).
//
// Numbers measured on this repository on 26/08 (Q-C of the spec asked for the real weight):
//
//   git clone --depth 50           1.5 s     14 MB
//   git fetch (existing clone)     0.9 s      —        ← what a D13 wake-up does
//   pnpm install, EMPTY store     18.2 s    639 MB of store + 642 MB of node_modules
//   pnpm install, WARM store       2.9 s    +14 MB only (hard links to the store)
//
// The last line decides: the clone was not the cost, the install was.
//
// What D14 guarantees and what it does not. The certain gain is the DOWNLOAD. The "+14 MB" assumes
// HARD LINKS between the store and `node_modules`, NOT promised here: `/workspace` and `/pkg-cache`
// are two distinct bind mounts, and Linux refuses `link()` across mount points (EXDEV) even on the
// same filesystem. pnpm then falls back to reflink (nearly free on XFS/btrfs), else copy. Still to
// be measured on the real host with docker.
//
// If those 640 MB per session become the issue, the lever is not the cache but the release, already
// wired to `done`, deletion and the boot sweep.
import fs from "node:fs";
import path from "node:path";
import {
  allRunners,
  sessionRowsByIds,
  sessionStatusesOfTask,
  taskStatusesByIds,
} from "./workspace-store.js";
import { ACTIVE_STATUSES } from "../session-terminal.js";
import { DOCKER_QUICK_MS, docker } from "../../shared/docker-exec.js";
import { sessionFilesAreVolumes } from "./mount-mode.js";
import type { RuntimeMode } from "../../updates/stamp.js";
import { parseVolume, releaseSessionVolumes, removeVolumes } from "./volumes.js";
import { TASK_STATUS } from "../../tasks/lifecycle.js";
import { RUNNER_KIND } from "../../shared/enums.js";
import { createLogger } from "../../shared/log.js";

// The boot release summary goes to `control_events` (`index.ts`); a failed folder removal is a
// diagnostic of the moment.
const log = createLogger("workspace");

const DATA_ROOT = path.resolve(process.env.LEGION_DATA ?? "data");
const SESSIONS_DIR = path.join(DATA_ROOT, "sessions");

/** SHARED, mounted in every session on `/pkg-cache`. Its two subfolders are what the image
 *  expects: `pnpm-store/` (target of a symlink on the default store) and `npm/`
 *  (`npm_config_cache`). The NAMES are part of the contract with session-image/Dockerfile: changing
 *  them on one side only makes the cache silent, not broken. */
export const PACKAGE_CACHE_DIR = path.join(DATA_ROOT, "package-cache");
const PACKAGE_CACHE_SUBDIRS = ["pnpm-store", "npm"];

/** Sibling of `claude/`, under the same session folder: both live and die with it. */
export function workspaceDir(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId, "workspace");
}

/** Called by the docker runner right before `run`, like `claudeStateDir`: the recipe that already
 *  works with a container running as `agent` (Q-B of the spec: reused, not invented). */
export function ensureMountDirs(spec: {
  workspaceDir: string;
  packageCacheDir: string | null;
}): void {
  fs.mkdirSync(spec.workspaceDir, { recursive: true });
  if (spec.packageCacheDir)
    for (const sub of PACKAGE_CACHE_SUBDIRS)
      fs.mkdirSync(path.join(spec.packageCacheDir, sub), { recursive: true });
}

/** A session's state, reduced to what decides its workspace's fate. */
export type WorkspaceOwner = { id: string; status: string; taskStatus: string | null };

/** States KNOWN to be terminal: a session carrying them never resumes, and a new run of its task
 *  opens a new session, hence a new folder.
 *
 *  Deliberately the list of DEAD states, not living ones. Both describe the same world today, not
 *  tomorrow: a status added later falls on the "keep" side (extra disk) rather than "erase" (one
 *  session fewer). `waiting` is not there: that is exactly where the workspace must hold, since the
 *  container is already destroyed. */
const TERMINAL = new Set(["destroyed", "failed"]);

/**
 * Which on-disk workspaces may go. PURE: the rule, testable without docker, database or
 * filesystem.
 *
 * Three reasons to release, nothing else:
 *  · unknown session (row deleted with the task): nobody will claim it;
 *  · session in a certain terminal state (see `TERMINAL`);
 *  · task `done`: the release the spec asks for, which also applies to the sweep.
 *
 * The error leans the same way everywhere: keeping one folder too many costs disk, deleting one
 * too many costs a live session's unpushed work.
 */
export function workspacesToRelease(onDisk: string[], owners: WorkspaceOwner[]): string[] {
  const byId = new Map(owners.map((o) => [o.id, o]));
  return onDisk.filter((id) => {
    const owner = byId.get(id);
    if (!owner) return true;
    return TERMINAL.has(owner.status) || owner.taskStatus === TASK_STATUS.done;
  });
}

/** Session ids with a `workspace/` folder on disk. */
export function workspacesOnDisk(): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs
    .readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SESSIONS_DIR, e.name, "workspace")))
    .map((e) => e.name);
}

/** Never throws: freeing disk is no reason to fail a task's end, but failure is SAID, not
 *  swallowed in a silent catch (rule of 23/08). */
export function releaseWorkspace(sessionId: string): boolean {
  const dir = workspaceDir(sessionId);
  try {
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (err) {
    log.warn("workspace not released", { sessionId, error: (err as Error).message });
    return false;
  }
}

/** Release on `done` and on deletion: the workspaces of this task's sessions that NO LONGER WORK.
 *
 *  The filter is the 30/08 fix, and it repairs a silent loss of work. The original comment said
 *  "the two moments when nobody can resume the work in there". True of `deleteTask`, FALSE of a
 *  `done` coming from inside a live session, which is the normal path since the brief asks the
 *  agent to call `update_task` with `done` when finished.
 *
 *  What happened, measured on a real session: the agent writes its file, calls `done`,
 *  `onTaskDone` removes `/workspace` from under it, then the still-living session reaches its final
 *  push and fails on `spawn git ENOENT`. The session ends with code 0, the task goes `done`, and
 *  NOTHING IS PUSHED. No screen says so; only a `repo_push_failed` in the trace.
 *
 *  It only bit on "write access + done from the session", i.e. exactly the nominal case.
 *
 *  A still-active session keeps its workspace; it goes at its terminal transition like every other
 *  path. `ACTIVE_STATUSES` (session-terminal.ts) is the only list answering "is it still working". */
export function releaseWorkspacesOfTask(taskId: string): number {
  const sessions = sessionStatusesOfTask(taskId);
  const doomed = sessions.filter((s) => !(ACTIVE_STATUSES as readonly string[]).includes(s.status));
  // v52: the same decision on the other side of the network. On a remote runner session files are
  // docker volumes, not folders (`volumes.ts`): the rule "these no longer work, their files may
  // go" is made HERE, once, and both storage forms follow it. `void` because docker answers when
  // it does and this function reports on the local disk; failures are reported in `removeVolumes`.
  void releaseSessionVolumes(doomed.map((s) => s.id));
  return doomed.filter((s) => releaseWorkspace(s.id)).length;
}

/**
 * The boot sweep. Run AFTER `recoverOrphanSessions()`, which decides which "active in the
 * database" sessions still have a living container. Sweeping before would erase the `/workspace`
 * mounted under a session the server restart did not kill.
 */
export function sweepOrphanWorkspaces(): { released: number; kept: number } {
  const onDisk = workspacesOnDisk();
  if (onDisk.length === 0) return { released: 0, kept: 0 };
  const doomed = workspacesToRelease(onDisk, ownersOf(onDisk));
  const released = doomed.filter((id) => releaseWorkspace(id)).length;
  return { released, kept: onDisk.length - doomed.length };
}

/** Extracted from `sweepOrphanWorkspaces` when the remote sweep arrived: both ask the database the
 *  SAME question, and two constructions of `owners` would diverge at the first added status. */
function ownersOf(sessionIds: string[]): WorkspaceOwner[] {
  const sessions = sessionRowsByIds(sessionIds);
  const taskStatus = taskStatusesByIds([...new Set(sessions.map((s) => s.taskId))]);
  return sessions.map((s) => ({
    // Missing task → read as `done`: a session whose task disappeared has nobody left to resume
    // its work.
    id: s.id,
    status: s.status,
    taskStatus: taskStatus.get(s.taskId) ?? TASK_STATUS.done,
  }));
}

/**
 * The same sweep, for remote machines (v52).
 *
 * `workspacesOnDisk()` only knows THIS machine's disk, so a remote session's volumes entered no
 * sweep. Measured on 01/09 on mini-atelier: a finished mock session leaves `legion-workspace-*` and
 * `legion-claude-*` behind, correctly marked orphaned by the Infra page, and nobody to take them
 * except an operator click. At 640 MB of dependencies per session, an unwatched machine fills up.
 *
 * The rule is the SAME (`workspacesToRelease`), applied per RUNNER, because a volume carrying the id
 * of a session routed elsewhere is a leftover here.
 *
 * Run AFTER `recoverOrphanSessions()`, for the same reason as the local sweep.
 */
export async function sweepOrphanVolumes(
  mode?: RuntimeMode,
): Promise<{ released: number; kept: number }> {
  // The filter is on MOUNT MODE, not on having a `dockerHost` (05/09): a containerised control
  // plane gives volumes to its OWN daemon's sessions, and this sweep was the only one able to reclaim
  // them. A runner without volumes has nothing to do here; `sweepOrphanWorkspaces` sweeps its
  // folders.
  const runners = allRunners().filter(
    (r) => r.kind === RUNNER_KIND.docker && r.enabled && sessionFilesAreVolumes(r.dockerHost, mode),
  );
  let released = 0;
  let kept = 0;
  for (const runner of runners) {
    const host = runner.dockerHost;
    const ls = await docker(
      ["volume", "ls", "--filter", "name=legion-", "--format", "{{.Name}}"],
      host,
      DOCKER_QUICK_MS,
    );
    // Sleeping machine or silent daemon: we do not KNOW who is alive, so nothing is erased.
    if (ls.code !== 0) continue;
    const byId = new Map<string, string[]>();
    for (const name of ls.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      const { sessionId } = parseVolume(name);
      if (sessionId) byId.set(sessionId, [...(byId.get(sessionId) ?? []), name]);
    }
    const ids = [...byId.keys()];
    if (ids.length === 0) continue;
    const doomed = new Set(workspacesToRelease(ids, ownersOf(ids)));
    const names = ids.filter((id) => doomed.has(id)).flatMap((id) => byId.get(id)!);
    kept += ids.length - doomed.size;
    released += (await removeVolumes(names, host)).removed.length;
  }
  return { released, kept };
}
