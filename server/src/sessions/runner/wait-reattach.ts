// The pipe is not the session (01/09, multi-machine work, slice 05).
//
// `docker wait` is the only call in the project WITHOUT a ceiling: it waits for an EVENT (the
// container exit) that comes in two minutes or six hours. On an `ssh://` runner it holds an ssh
// connection open all that time, and an ssh connection to a strong machine dies at the first
// sleep. The container does not die: it sleeps with its machine and resumes on wake-up.
//
// Before this module, the break read as `code !== 0`, hence `exitCode = 1`. The session ended with
// "exited with code 1", the container stayed up on the remote machine, and the work was lost for a
// reason that was none. The 20/08 incident seen from the other end: concluding a session is dead
// without asking Docker. `recoverOrphanSessions` learnt to ask at BOOT; the wait loop learns it here
// while the session LIVES.
//
// The one trap in this file: `docker wait` answers on two channels carrying the same numbers. When
// all is well, the CLI exits 0 and WRITES the container's code on stdout. When the transport breaks,
// ssh returns 255, but the docker CLI does not return that code: it exits 1 and COPIES its
// connection helper's code into its message. A container that exited 255 and a dead ssh carry the
// same number on two channels, and confusing them either kills a live session or waits half an
// hour for a container already dead.
import { docker, type DockerResult } from "../../shared/docker-exec.js";
import { createLogger } from "../../shared/log.js";

// The VERDICT (host unreachable) goes up as an exception to `runLifecycle` (lifecycle.ts), which
// records it as the failure reason. The two lines here describe the attempt in progress.
const log = createLogger("wait");

/** How many times to REATTACH before concluding. Bounded: a pipe breaking at every reattach is not
 *  a sleeping machine but a broken network, and a session reattaching forever holds a runner slot
 *  nobody ever gets back. */
export const REATTACH_MAX = 5;
/** Probes per break, and at what pace. The product is the window granted to a sleeping machine:
 *  60 × 30 s = half an hour. A lid closed over lunch does not kill the session, and a machine
 *  switched off for the night does not hold its slot until morning. The period is the fleet probe's
 *  (`infra/probe.ts`), for the same reason: often enough to see a wake-up, rarely enough to weigh
 *  nothing. */
export const HOST_PROBE_ATTEMPTS = 60;
export const HOST_PROBE_PERIOD_MS = 30_000;

/** What `docker wait` REALLY said: the container exited, or the daemon was not reached. */
export type WaitOutcome = { kind: "exit"; exitCode: number } | { kind: "transport"; why: string };

/** ssh(1): "ssh exits with the exit status of the remote command or with 255 if an error
 *  occurred". The TRANSPORT code, and only that. */
const SSH_TRANSPORT_STATUS = 255;
/** The connection helper's code, CAPTURED as a number. The docker CLI writes "command [ssh …] has
 *  exited with exit status N"; we read N, not the sentence. An `includes("255")` on the whole
 *  message would also match a container fingerprint containing those digits. */
const HELPER_STATUS = /\bexited with exit status (\d+)/;
/** The marker the CLI puts at the START of its message when it reached NO daemon, whatever the
 *  transport. It tells it apart from a daemon that answered no ("Error response from daemon: …").
 *  Tested at line start: the same words mid-sentence would be a sentence, not a verdict. */
const NO_CONNECT = /^error during connect\b/i;

/** The criterion, PURE: only the docker CLI's exit code, stdout and stderr.
 *
 *  Separate from the loop because it is the only thing here that can be wrong because of what a CLI
 *  we do not control writes, hence the only thing worth testing on messages copied verbatim. */
export function readWaitOutcome({ code, stdout, stderr }: DockerResult): WaitOutcome {
  // The normal path reads stdout. An unreadable `stdout` under code 0 cannot be a transport break
  // (the CLI would have failed): fall back to 1, as before this module.
  if (code === 0) {
    const parsed = Number.parseInt(stdout.trim(), 10);
    return { kind: "exit", exitCode: Number.isNaN(parsed) ? 1 : parsed };
  }
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const helper = lines.map((l) => HELPER_STATUS.exec(l)).find((m) => m !== null);
  if (helper && Number(helper[1]) === SSH_TRANSPORT_STATUS)
    return { kind: "transport", why: `ssh returned ${SSH_TRANSPORT_STATUS} (transport error)` };
  const noConnect = lines.find((l) => NO_CONNECT.test(l));
  if (noConnect) return { kind: "transport", why: noConnect.slice(0, 200) };
  // The daemon answered, and said no: unknown container, refused argument. That is an end.
  return { kind: "exit", exitCode: 1 };
}

/** Waits for the container exit, reattaching when it is the PIPE that broke.
 *
 *  Receives its two effects instead of building them: `attempt` is a `docker wait`, `hostReachable`
 *  the daemon probe. That lets tests run the loop without a daemon and with a zero clock.
 *
 *  Throws when the host does not come back: the message starts with "host unreachable", because
 *  `runLifecycle` records it as is as the failure reason, and that is where to look. */
export async function waitWithReattach(
  attempt: () => Promise<DockerResult>,
  hostReachable: () => Promise<boolean>,
  opts: { container: string; sleep?: (ms: number) => Promise<void> },
): Promise<number> {
  const nap = opts.sleep ?? defaultNap;
  for (let breaks = 0; ; breaks++) {
    const outcome = readWaitOutcome(await attempt());
    if (outcome.kind === "exit") return outcome.exitCode;
    // Two messages, not one, as `pickRunnerRow` tells "nobody answers" from "no room": two
    // failures, two gestures. Here the daemon ANSWERS between breaks, so it is the link that does not
    // hold, and the network is what to look at, not the machine.
    if (breaks >= REATTACH_MAX)
      throw new Error(
        `host unreachable: the pipe to ${opts.container} broke ${breaks + 1} times ` +
          `(${outcome.why}) while its daemon answered in between — the link does not hold`,
      );
    log.warn("broken pipe — probing the host again before concluding", {
      container: opts.container,
      why: outcome.why,
      attempt: `${breaks + 1}/${REATTACH_MAX}`,
    });
    if (!(await hostBack(hostReachable, nap)))
      throw new Error(
        `host unreachable: no answer from its daemon in ` +
          `${Math.round((HOST_PROBE_ATTEMPTS * HOST_PROBE_PERIOD_MS) / 60_000)} min after the pipe to ` +
          `${opts.container} broke (${outcome.why})`,
      );
    log.info("host reachable again — reattaching", { container: opts.container });
  }
}

/** Sleep FIRST, probe after: a probe right after the break can only confirm what we just
 *  learnt. */
async function hostBack(
  hostReachable: () => Promise<boolean>,
  nap: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let n = 0; n < HOST_PROBE_ATTEMPTS; n++) {
    await nap(HOST_PROBE_PERIOD_MS);
    if (await hostReachable()) return true;
  }
  return false;
}

/** `unref`: a bounded nap must never be why the process refuses to exit. The HTTP server keeps the
 *  event loop alive, not us. */
function defaultNap(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/** Production `docker wait`, on ONE container, on ONE host. Here so `DockerRunner.wait` stays one
 *  line and the `"unbounded"` budget (the only one in the project) sits next to its justification.
 *
 *  A ceiling here would be a regression already paid for: the first docker-exec version set one by
 *  default, and three sessions were cut at exactly 120 s, reported as "code 1". This module adds no
 *  ceiling, it reads the DIFFERENCE between a container exiting and a pipe breaking. */
export function dockerWaitOnce(
  container: string,
  dockerHost: string | null,
): Promise<DockerResult> {
  return docker(["wait", container], dockerHost, "unbounded");
}
