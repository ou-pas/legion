// Keeps a Mac awake while it works (01/09, multi-machine work, slice 05).
//
// Sessions run on the strong machines, and those are Macs. After its idle delay macOS suspends
// everything: the container does not crash, it sleeps until someone touches the keyboard. A
// two-hour task started in the evening ends up frozen at fifteen minutes, and nothing in Docker
// says so.
//
// `caffeinate -i cat`, not `caffeinate -i` alone: the pipe is the leash. When our `ssh` dies
// (session over, control plane stopped, network cut), `cat` gets EOF and `caffeinate` exits with
// it. Without a command to watch, the assertion would outlive the connection and keep the Mac
// awake forever.
//
// The only place in that work that assumes an ssh shell, and it is optional by construction: the
// constraint is "nothing to install on remote machines". A non-Mac host,
// a missing `caffeinate`, a refusing ssh: we say so once per host and no session suffers.
//
// Not covered: `-i` prevents IDLE sleep only. Closing the lid sleeps the machine anyway; the
// reattach (`wait-reattach.ts`) handles that case.
import { spawn, type ChildProcess } from "node:child_process";
import { sshTargetOf } from "../../shared/ssh-target.js";
import { createLogger } from "../../shared/log.js";

const log = createLogger("caffeinate");

/** Short: nothing waits on it (the session already started), but an ssh hanging ten minutes on a
 *  machine that is off is one more process for nothing. */
const CONNECT_TIMEOUT_S = 10;

/** How many sessions hold a host awake, and the ssh holding it. */
type Hold = { count: number; child: ChildProcess | null };
const holds = new Map<string, Hold>();
/** Hosts already reported as not staying awake. One message per session on a Linux without
 *  `caffeinate` would be noise, and noise teaches people to ignore it. */
const told = new Set<string>();

type Spawner = (cmd: string, args: string[]) => ChildProcess;
/** `stdio` matters: stdin is the PIPE the remote `cat` depends on, stdout is useless, stderr is
 *  the only thing worth telling when it goes wrong. */
const realSpawn: Spawner = (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
let spawner: Spawner = realSpawn;

/** For tests: checking a host counter must not require a Mac at the end of an ssh (same pattern
 *  as `wireFakeRunner`). */
export function setHoldSpawnForTests(fn: Spawner | null): void {
  spawner = fn ?? realSpawn;
}
/** For tests: two cases in the same process would otherwise share the counters and what was
 *  already reported. */
export function resetHoldsForTests(): void {
  holds.clear();
  told.clear();
}

/** `null` when there is no shell to run it in (local socket, `tcp://`, unreadable URL): not a
 *  failure, the question does not arise.
 *
 *  No shell is involved: `spawn` gets an array, so neither the user nor the host of the
 *  operator-declared URL can escape into a command. */
export function caffeinateArgs(dockerHost: string): string[] | null {
  const t = sshTargetOf(dockerHost);
  if (!t) return null;
  return [
    "-T", // no tty: only a pipe
    "-o",
    "BatchMode=yes", // never prompt a machine nobody sits in front of
    "-o",
    `ConnectTimeout=${CONNECT_TIMEOUT_S}`,
    ...(t.port ? ["-p", t.port] : []),
    t.target,
    "caffeinate -i cat",
  ];
}

/** Returns the release function, idempotent: a `finally` running twice must not put the machine
 *  to sleep under the neighbouring session. */
export function holdHostAwake(dockerHost: string | null): () => void {
  const args = dockerHost ? caffeinateArgs(dockerHost) : null;
  if (!dockerHost || !args) return () => {};
  const held = holds.get(dockerHost);
  if (held) held.count += 1;
  else holds.set(dockerHost, { count: 1, child: start(dockerHost, args) });
  return releaseOnce(dockerHost);
}

function releaseOnce(host: string): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const held = holds.get(host);
    if (!held) return;
    held.count -= 1;
    if (held.count > 0) return;
    holds.delete(host);
    // The remote `cat` gets EOF and `caffeinate` exits with it: the machine may sleep again.
    held.child?.kill();
  };
}

function start(host: string, args: string[]): ChildProcess | null {
  try {
    const child = spawner("ssh", args);
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr = (stderr + String(d)).slice(0, 300);
    });
    child.on("error", (e: Error) => tolerate(host, e.message));
    child.on("exit", (code: number | null, signal: string | null) => {
      // Killed by us at the last session: the normal path. `holds` no longer has the host at that
      // moment, which is what tells the two deaths apart.
      if (signal || !holds.has(host)) return;
      tolerate(host, stderr.trim() || `ssh returned ${code}`);
    });
    return child;
  } catch (e) {
    tolerate(host, (e as Error).message);
    return null;
  }
}

function tolerate(host: string, why: string): void {
  if (told.has(host)) return;
  told.add(host);
  log.warn(
    "host not kept awake — non-mac, command missing or ssh refused; sessions still run " +
      "there, but a machine that falls asleep freezes one until it wakes",
    { host, why },
  );
}
