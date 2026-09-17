// Resuming in a terminal, whichever machine ran the session (v52, multi-machine work, slice 06).
//
// The defect: `GET /api/sessions/:id/resume-command` built `CLAUDE_CONFIG_DIR=<LEGION_DATA>/
// sessions/<id>/claude`, a path on THIS machine's disk, the SIXTH tie to the local disk, missing
// from the work's list of five. For a session that ran on an `ssh://` runner, the Claude state is in
// the OTHER machine's `legion-claude-<id>` volume: the local folder does not exist, `claude --resume`
// opens an empty conversation, and nothing says why. The gesture failed in the operator's terminal,
// where the control plane can no longer explain anything.
//
// The option kept, and why. The slice offered three. This one BRINGS BACK the state on demand,
// through the same `DOCKER_HOST`, then returns today's command unchanged. It wins not by being
// shortest but by leaving ONE command shape in the product: after the copy, a remote session is
// indistinguishable from a local one, for the reader (the claude CLI) and for the code.
//
// A command that CROSSES over (`ssh -t operator@host docker run -it …`) would have been a second
// shape, assuming two things we do not control: that the operator has SSH to the session machine
// themselves, and that the image can run an interactive claude under an entrypoint built for a
// driven session. REFUSING with an explanation meets criterion 3 and drops criterion 2.
//
// One way only, deliberately, which is what makes the copy legitimate: resuming in a terminal
// diverges the state anyway (the human takes over, the container session is over), so the remote
// volume need not be kept in sync. Load-bearing consequence: when the state is ALREADY on the local
// disk, it is not copied again. A second copy would overwrite with a stale snapshot the conversation
// the operator just continued, the only path in this file that could destroy work.
//
// Still wrong, and out of this slice's reach: the returned command names a path on the CONTROL
// PLANE's disk. The day the control plane lives on the home server and the operator sits at their
// MacBook, that path is no more theirs than the remote volume was. But that has been true of LOCAL
// sessions from day one, and criterion 1 freezes that very command: the defect predates this and is
// shared by both cases, and this slice reduces it to ONE place instead of two.
import fs from "node:fs";
import path from "node:path";
import { projectSessionImageOfTask, runnerLocation, sessionRow } from "./resume-command-store.js";
import { type DockerExec, docker, dockerDaemonReachable } from "../shared/docker-exec.js";
import { sessionFilesAreVolumes } from "./runner/mount-mode.js";
import {
  CLAUDE_STATE_MOUNT,
  DEFAULT_SESSION_IMAGE,
  copyVolumeOut,
  volumeNames,
} from "./runner/volumes.js";
import type { RuntimeMode } from "../updates/stamp.js";

/** Same shape as `PauseRefusal` for the refusal (status + sentence relayed as is by the UI), because
 *  it is the same front-end contract. */
export type ResumeCommand =
  | { ok: true; command: string; note: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** A nanoid's character set, nothing else. Used twice: on `sdkSessionId`, which enters a shell
 *  command, and on the session id, which now enters a `path.resolve` WHERE WE WRITE and a volume
 *  name. The first check was defence in depth; the second became necessary once this file stopped
 *  only building a string. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const LOCAL_NOTE = "resumes the agent's conversation in your terminal, with all its context";
const remoteNote = (runner: string) =>
  `the Claude state is brought back from ${runner} — one way: what you do in this terminal will` +
  " not go back to that machine";

/** Shell single-quoting: the command is pasted into a terminal, and a path can contain a space. */
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** `readdirSync` rather than `existsSync`: a failed `docker cp` may have left the folder created and
 *  empty, and an empty folder must never pass for a brought-back state, the exact silence this slice
 *  fixes. */
function hasState(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** The project's image, else the control plane's. The copy container needs NOTHING from it (it never
 *  starts), only that it be present on the remote machine, which this resolution, the manager's
 *  own, guarantees. */
function sessionImage(taskId: string): string {
  return projectSessionImageOfTask(taskId)?.trim() || DEFAULT_SESSION_IMAGE;
}

/**
 * The command to paste, or the written reason for not returning one.
 *
 * `exec` is injectable for the same reason as in `volumes.ts`: the three remote outcomes (sleeping
 * machine, swept volume, refused copy) are STATES, not test failures, and each must be assertable
 * without a daemon.
 */
export async function resumeCommandFor(
  sessionId: string,
  exec: DockerExec = docker,
  mode?: RuntimeMode,
): Promise<ResumeCommand> {
  const session = sessionRow(sessionId);
  if (!session) return { ok: false, status: 404, error: "session not found" };
  if (session.mock) return { ok: false, status: 400, error: "mock session — nothing to resume" };
  if (!session.sdkSessionId)
    return { ok: false, status: 400, error: "no sdkSessionId (init lost)" };
  if (!SAFE_ID.test(session.sdkSessionId))
    return { ok: false, status: 400, error: "unsafe sdkSessionId" };
  if (!SAFE_ID.test(session.id)) return { ok: false, status: 400, error: "unsafe session id" };

  const configDir = path.resolve(
    process.env.LEGION_DATA ?? "data",
    "sessions",
    session.id,
    "claude",
  );
  const command = `CLAUDE_CONFIG_DIR=${shq(configDir)} claude --resume ${session.sdkSessionId}`;

  const runner = runnerLocation(session.runnerId);
  // Is the state a FOLDER on this machine? Then it is already here, and this is the pre-slice
  // command, character for character. No docker call: the common case does not pay for the remote
  // one.
  //
  // The question is no longer "does the runner have a `dockerHost`?" (05/09): a containerised
  // control plane stores its OWN daemon's state in a volume, and returning the local command would
  // open an empty conversation, the exact failure this file fixes for `ssh://`. Runner gone: we no
  // longer know, and the local folder is all we can offer.
  if (!runner || !sessionFilesAreVolumes(runner.dockerHost, mode))
    return { ok: true, command, note: LOCAL_NOTE };

  const volume = volumeNames(session.id).claudeState;
  if (hasState(configDir)) return { ok: true, command, note: remoteNote(runner.name) };

  // Does the machine answer? Asked BEFORE `volume inspect` so the two refusals stay distinct:
  // "it sleeps" and "nothing is left" call for different gestures, and an unreachable host would fail
  // the inspection on an unreadable ssh error. `DOCKER_PROBE_MS` bounds the wait to five seconds.
  const reachable = await dockerDaemonReachable(runner.dockerHost, exec);
  if (!reachable.ok)
    return {
      ok: false,
      status: 409,
      error:
        `machine “${runner.name}” is not answering (${reachable.why}). The Claude state of this` +
        ` session lives over there, in volume ${volume}: wake it and ask again.`,
    };

  const brought = await copyVolumeOut(
    {
      volume,
      fromPath: CLAUDE_STATE_MOUNT,
      image: sessionImage(session.taskId),
      destDir: configDir,
    },
    { dockerHost: runner.dockerHost, exec },
  );
  if (!brought.ok)
    return {
      ok: false,
      status: 409,
      error:
        `the Claude state could not be brought back from “${runner.name}”: ${brought.why}.` +
        " No command is returned — it would open an empty conversation.",
    };
  return { ok: true, command, note: remoteNote(runner.name) };
}
