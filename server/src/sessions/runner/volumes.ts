// A session's files when its runner is elsewhere (v52, multi-machine work, slice 02).
//
// `docker.ts` mounted five paths resolved on the CONTROL PLANE's disk. With
// `DOCKER_HOST=ssh://mini-atelier`, Docker interprets them on the REMOTE host, where none of it
// exists: the daemon creates empty folders there and the session starts without repository, Claude
// state or key. No error, just a session working on nothing.
//
// Two deliberate paths, not a unified one. The local runner keeps its bind mounts: `workspace.ts`
// is built on them (clone reuse at wake-up, `releaseWorkspace`, the boot sweep) and it works. The
// remote runner takes named volumes.
//
// Three of the five mounts have no content to ship, which halved the slice.
// `session-image/Dockerfile` creates `/workspace`, `/claude-state` and `/pkg-cache/{pnpm-store,npm}`
// and `chown agent:agent`s them. Docker copies the image's content AND permissions into an EMPTY
// named volume on first mount, so the volume arrives owned by `agent` with nothing to seed. That
// also replaces the Dockerfile's `[safe] directory = *` for those mounts: files no longer carry a
// foreign host's uid.
//
// Only one mount carries content from the control plane's disk: the project's SSH key and the
// `known_hosts` next to it.
//
// The clone has nothing to do here. It already happens INSIDE the session container (`setupRepos`
// in the payload), with a credential store written from `spec.repos[].credential`, and the spec
// arrives over HTTP at boot (`boot.ts`). Moving it into a seeding container would have caused the
// uid problem the slice flagged: seeding clones under one uid, the session reads under another.
import fs from "node:fs";
import { dockerHostByRunnerId, runnerIdsOfSessions } from "./volumes-store.js";
import {
  DOCKER_PROBE_MS,
  DOCKER_QUICK_MS,
  DOCKER_START_MS,
  type DockerExec,
  docker,
} from "../../shared/docker-exec.js";
import { sessionFilesAreVolumes } from "./mount-mode.js";
import type { RuntimeMode } from "../../updates/stamp.js";
import { createLogger } from "../../shared/log.js";

const log = createLogger("volumes");

/** WHERE a docker gesture runs: which daemon, and through which function. The two always travel
 *  together: the host says whom to talk to, `exec` is the tests' injection point, and tests need
 *  both or neither. */
export interface DockerEndpoint {
  dockerHost: string | null;
  exec?: DockerExec;
}

/** The control plane's default session image. Duplicates `SESSION_IMAGE`
 *  (`infra/fleet-images.ts`); a value in two copies drifts at the first change. */
export const DEFAULT_SESSION_IMAGE = process.env.LEGION_SESSION_IMAGE ?? "legion-session:latest";

/** SHARED by every session on a host, like the local `package-cache` folder. A volume per session
 *  would make it useless: it pays off at the second `pnpm install`. */
export const PACKAGE_CACHE_VOLUME = "legion-pkg-cache";

/** The SAME folder the local bind mounts targeted file by file: `session-image/entrypoint.sh` looks
 *  for `ssh-key` and `known-hosts` there without knowing where they come from. That lets both paths
 *  share one image and one entrypoint. */
export const SECRETS_MOUNT = "/run/legion";
export const SECRET_SSH_KEY = "ssh-key";
export const SECRET_KNOWN_HOSTS = "known-hosts";

/** Where Claude state is mounted in the container, on both paths (`CLAUDE_CONFIG_DIR`). Named for
 *  the same reason as `SECRETS_MOUNT`: the terminal resume must reread this folder INSIDE the remote
 *  volume, and a path guessed by the reader is not a shared path. `runner/docker.ts` still keeps the
 *  literal. */
export const CLAUDE_STATE_MOUNT = "/claude-state";

/** Prefixed `legion-` like containers and networks, so `infra.ts` finds them with the same filter
 *  and counts them in the same orphans. */
export const volumeNames = (sessionId: string) => ({
  workspace: `legion-workspace-${sessionId}`,
  claudeState: `legion-claude-${sessionId}`,
  secrets: `legion-secrets-${sessionId}`,
});

const VOLUME_PREFIXES = [
  ["legion-workspace-", "workspace"],
  ["legion-claude-", "claude-state"],
  ["legion-secrets-", "secrets"],
] as const;

// `"autre"` is a stored/API value (French for "other"), kept as is.
export type VolumeRole = (typeof VOLUME_PREFIXES)[number][1] | "autre";

/** `sessionId: null` keeps a volume out of orphan marking: the shared package cache, just as the
 *  browser service escapes it on the container side. */
export function parseVolume(name: string): { role: VolumeRole; sessionId: string | null } {
  for (const [prefix, role] of VOLUME_PREFIXES)
    if (name.startsWith(prefix)) return { role, sessionId: name.slice(prefix.length) };
  return { role: "autre", sessionId: null };
}

/** The only callers pass the two constants above; the check exists because a name crossing a shell
 *  unchecked is an injection waiting for a future careless caller. */
const SAFE_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Seeds the secrets volume: one container, through the same DOCKER_HOST as everything else.
 *
 * No shell access to the remote host is assumed, only Docker. That is the work's constraint
 * ("NOTHING to install on remote machines") and what makes this testable with a fake executor.
 *
 * Content enters through STANDARD INPUT. Not `-e`, readable in `docker inspect` for the
 * container's whole life; not a temporary file on the host, which survives the failure that
 * prevents removing it; not an argument, which `ps` shows. That is why `docker()` gained `stdin`.
 *
 * `0444` rather than `0400`, not a loosening: the entrypoint runs as `agent`, whose uid is unknown
 * here (a project image may differ), so a root-owned owner-only file would be UNREADABLE at start,
 * `[ -r … ]` fails silently and the session starts keyless. The entrypoint copies it at 0600 into
 * `agent`'s HOME, and ssh reads that copy. The volume does not outlive the container (`destroy`
 * removes it), whereas the bind-mounted file lived forever.
 *
 * One container per file: two one-second `docker run`s, against a hand-written tar to make one.
 * There are never more than two files.
 */
export async function seedSecretVolume(
  volume: string,
  image: string,
  files: { name: string; content: Buffer }[],
  on: DockerEndpoint,
): Promise<void> {
  const { dockerHost, exec = docker } = on;
  for (const f of files) {
    if (!SAFE_NAME.test(f.name)) throw new Error(`secret name refused: ${f.name}`);
    const target = `/seed/${f.name}`;
    const r = await exec(
      [
        "run",
        "--rm",
        "-i",
        "--pull=never",
        // `--user 0`: the volume is mounted on a path the image does not know, so Docker creates it
        // root-owned and `agent` could not write there.
        "--user",
        "0",
        // `--network=none`: this container writes a file, it has nothing to reach. A seeding step
        // carrying a private key is the last place to leave a route open.
        "--network",
        "none",
        "--entrypoint",
        "/bin/sh",
        "-v",
        `${volume}:/seed`,
        image,
        "-c",
        `cat > ${target} && chmod 0444 ${target}`,
      ],
      dockerHost,
      DOCKER_START_MS,
      f.content,
    );
    // Fatal, on purpose. A session granted an SSH repository whose key did not arrive fails
    // anyway, but six seconds later on "Permission denied (publickey)", a message pointing to the
    // wrong side.
    if (r.code !== 0)
      throw new Error(
        `seeding the secrets volume failed (${f.name}): ${(r.stderr || r.stdout).slice(0, 300)}`,
      );
  }
}

/**
 * Seeding the other way: bring a remote volume's CONTENT back to the control plane's disk (v52,
 * slice 06).
 *
 * Same constraint as `seedSecretVolume`, and it dictates the shape: nothing installed remotely,
 * only Docker reachable. So no `rsync`, no `ssh cat`, no `tar` read on stdout: `docker()` buffers
 * output as a STRING and a history `.jsonl` would come out corrupted.
 *
 * That leaves `docker cp`, an API call: the local CLI writes the files itself, through the same
 * `DOCKER_HOST=ssh://…`. It needs a CONTAINER (Docker cannot copy from a bare volume), so one is
 * created that never starts: `create` mounts the volume, `cp` reads it, `rm -f` removes it.
 * `--entrypoint /bin/true` because an image without `CMD` would fail `create` on "no command
 * specified"; since the container never runs, Docker does not even check the path.
 *
 * `--pull=never`: the image is necessarily there, the session ran with it.
 *
 * The container name has the `legion-` prefix so a leak (control plane killed between `create` and
 * `rm`) SHOWS on the Infra screen. It is removed whatever happens, including when the copy fails.
 *
 * No `-a` on `cp`, deliberately: archive mode would keep the container uid (`agent`), unreadable
 * for the control plane. The default gives the files to the calling user, the one who rereads them.
 */
export async function copyVolumeOut(
  what: { volume: string; fromPath: string; image: string; destDir: string },
  on: DockerEndpoint,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const { volume, fromPath, image, destDir } = what;
  const { dockerHost, exec = docker } = on;
  // Does the volume still exist? Asked first because "no" is not a failure: a long-finished
  // session had its volumes swept, a normal product state that deserves its own sentence rather
  // than a raw `cp` error.
  const inspect = await exec(["volume", "inspect", volume], dockerHost, DOCKER_PROBE_MS);
  if (inspect.code !== 0)
    return { ok: false, why: `volume ${volume} no longer exists on this host` };

  const container = `legion-copy-${volume}`;
  // A previous attempt killed between `create` and `rm` would leave this name taken, and `create`
  // would fail on "name already in use" while the state to bring back is intact. `rm -f` of a
  // missing container is a non-event.
  await exec(["rm", "-f", container], dockerHost, DOCKER_QUICK_MS);
  const created = await exec(
    [
      "create",
      "--pull=never",
      "--entrypoint",
      "/bin/true",
      "--name",
      container,
      "-v",
      `${volume}:${fromPath}`,
      image,
    ],
    dockerHost,
    DOCKER_QUICK_MS,
  );
  if (created.code !== 0)
    return {
      ok: false,
      why: `copy container refused: ${(created.stderr || created.stdout).trim().slice(0, 200)}`,
    };

  try {
    // `docker cp` requires the destination to exist; created HERE and not by the caller, because a
    // helper failing on a forgotten `mkdir` is a trap for the next caller.
    fs.mkdirSync(destDir, { recursive: true });
    // `/.`: the folder's CONTENT into `destDir`, not one more subfolder.
    const copied = await exec(
      ["cp", `${container}:${fromPath}/.`, destDir],
      dockerHost,
      DOCKER_QUICK_MS,
    );
    if (copied.code !== 0)
      return { ok: false, why: (copied.stderr || copied.stdout).trim().slice(0, 200) };
    return { ok: true };
  } finally {
    await exec(["rm", "-f", container], dockerHost, DOCKER_QUICK_MS);
  }
}

/** Never throws: freeing disk is no reason to fail a session end. But failure is SAID: a `volume
 *  rm` refused because the volume is in use is the RIGHT answer (a session still lives), and it
 *  must be readable. */
export async function removeVolumes(
  names: string[],
  dockerHost: string | null,
  exec: DockerExec = docker,
): Promise<{ removed: string[]; errors: string[] }> {
  const removed: string[] = [];
  const errors: string[] = [];
  for (const name of names) {
    const r = await exec(["volume", "rm", name], dockerHost, DOCKER_QUICK_MS).catch(() => ({
      code: 1,
      stdout: "",
      stderr: "docker executor unavailable",
    }));
    if (r.code === 0) removed.push(name);
    else if (!/no such volume|not found/i.test(r.stderr))
      errors.push(`${name}: ${r.stderr.trim().slice(0, 160)}`);
  }
  if (errors.length) log.warn("volumes not removed", { errors });
  return { removed, errors };
}

/**
 * Releases the named sessions' volumes, on each one's runner.
 *
 * Wired to the SAME path as local workspace release (`workspace.ts`: `releaseWorkspacesOfTask`,
 * `sweepOrphanWorkspaces`, project purge), because it is the same decision made once: these
 * sessions no longer work, their work is pushed, their files may go. A second orphan rule for
 * volumes would diverge from the first at the first added status.
 *
 * Sessions whose files are FOLDERS are skipped: the caller already removed them. That is not the
 * same as "a local runner": a containerised control plane gives volumes to its own daemon
 * (`mount-mode.ts`), and skipping them would let them grow on the disk that control plane shares
 * with its sessions. `Promise<number>` because docker answers when it does, and callers fire it
 * with `void`.
 *
 * Both database reads come BEFORE the first `await`, and that is load-bearing. Purge callers
 * (`projects/purge.ts`) release BEFORE the transaction deleting the session rows, because after it
 * nothing links storage to a project. An `async` body runs synchronously until its first `await`,
 * so a `void releaseSessionVolumes(ids)` has already read what it needs when the caller resumes.
 * Moving these reads behind an `await` would silently drop the volumes from the purge.
 */
export async function releaseSessionVolumes(
  sessionIds: string[],
  exec: DockerExec = docker,
  mode?: RuntimeMode,
): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const sessions = runnerIdsOfSessions(sessionIds);
  const hosts = dockerHostByRunnerId();
  let removed = 0;
  // Grouped by host so as not to open one ssh connection per session. Names are passed one by one
  // so one refusal does not take the others down.
  const byHost = new Map<string | null, string[]>();
  for (const s of sessions) {
    const host = hosts.get(s.runnerId);
    if (host === undefined) continue; // runner gone: we no longer know which daemon to ask
    if (!sessionFilesAreVolumes(host, mode)) continue; // its files are folders, not volumes
    const n = volumeNames(s.id);
    byHost.set(host, [...(byHost.get(host) ?? []), n.workspace, n.claudeState, n.secrets]);
  }
  for (const [host, names] of byHost)
    removed += (await removeVolumes(names, host, exec)).removed.length;
  return removed;
}
