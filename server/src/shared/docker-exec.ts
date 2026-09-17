// The single docker executor (lot 40). A missing CLI resolves as a result to report (code +
// stderr), never a crash.
//
// The budget is required (25/08). When the Docker daemon stops, the socket may accept and then go
// silent, and `docker run` never returns: the session stayed `starting` forever and `stopSession`,
// using the same executor, froze too. A default cap was tried and killed every session after two
// minutes, because `docker wait` is meant to block while the container lives. The right value
// depends on what the command promises, so every caller states it; `"unbounded"` is written, not
// forgotten.
import { spawn } from "node:child_process";

export type DockerResult = { code: number; stdout: string; stderr: string };

/** Exit code of a call that did not answer in time (`timeout(1)` convention). */
export const DOCKER_TIMEOUT_CODE = 124;

/** How long to wait. `"unbounded"` = the command waits for an event (`docker wait`); a cap would
 *  kill the session. */
export type DockerBudget = number | "unbounded";

/** A probe: the daemon answers in milliseconds or not at all. */
export const DOCKER_PROBE_MS = 5_000;
/** A short gesture (rm, network rm, connect); if it drags, something is dead. */
export const DOCKER_QUICK_MS = 30_000;
/** A start: `run -d` may load an image. Generous, but finite. */
export const DOCKER_START_MS = 180_000;

/** Grace given to a stopping container (05/09, `docker stop -t`): enough for a `git push`, not for
 *  a session to start thinking again. */
export const DOCKER_STOP_GRACE_S = 30;
/** The stop call's budget, derived from the grace. `DOCKER_QUICK_MS` would land exactly on the
 *  grace deadline and make a clean stop look like a failure. */
export const DOCKER_STOP_MS = (DOCKER_STOP_GRACE_S + 15) * 1000;

/** `stdin` (v52): the way to get an SSH key into a volume on a remote host. `-e SECRET=…` shows in
 *  `docker inspect` for the container's life, and a temp file on the host survives a failure to
 *  remove it; stdin is written nowhere (not in `ps`, the container config, or the remote disk).
 *
 *  A `Buffer`, not a string: a key is a file, and a utf8 write would silently rewrite an invalid
 *  byte. */
export function docker(
  args: string[],
  dockerHost: string | null,
  budget: DockerBudget,
  stdin?: Buffer,
): Promise<DockerResult> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(dockerHost ? { DOCKER_HOST: dockerHost } : {}) };
    // `detached` makes the CLI a process group leader: on an `ssh://` host docker spawns `ssh`,
    // and killing docker alone orphans it. One night of probes to two sleeping Macs (01→02/09)
    // piled up nine thousand in the control plane container (PID table full, no docker command
    // could start, not even the fix). SIGKILL goes to the whole group.
    const p = spawn("docker", args, { env, detached: true });
    if (stdin !== undefined) {
      // Required: if docker exits before reading, the write raises EPIPE, which unhandled kills
      // the server. The exit code reports the real failure.
      p.stdin.on("error", () => {});
      p.stdin.end(stdin);
    }
    let stdout = "";
    let stderr = "";
    let done = false;
    // Resolve once, whichever path wins (timeout or close).
    const settle = (r: DockerResult) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    const timer =
      budget === "unbounded"
        ? null
        : setTimeout(() => {
            // SIGKILL, not SIGTERM: a CLI stuck on a silent daemon ignores politeness. On the
            // group (negative pid), so the ssh child dies too (see spawn).
            try {
              if (p.pid) process.kill(-p.pid, "SIGKILL");
              else p.kill("SIGKILL");
            } catch {
              p.kill("SIGKILL");
            }
            settle({
              code: DOCKER_TIMEOUT_CODE,
              stdout,
              stderr:
                `docker ${args[0] ?? ""} did not answer in ${Math.round(budget / 1000)} s` +
                " — is the daemon running?",
            });
          }, budget);
    timer?.unref?.(); // a pending timer must not keep the process alive
    p.stdout.on("data", (d) => {
      stdout += d;
    });
    p.stderr.on("data", (d) => {
      stderr += d;
    });
    p.on("error", (e) => settle({ code: 127, stdout: "", stderr: String(e) })); // missing CLI, not a server crash
    p.on("close", (code) => settle({ code: code ?? 1, stdout, stderr }));
  });
}

/** The injection seam for docker calls in tests. Same signature, `stdin` included, so a fake can
 *  check what went in. */
export type DockerExec = (
  args: string[],
  dockerHost: string | null,
  budget: DockerBudget,
  stdin?: Buffer,
) => Promise<DockerResult>;

/** What the probe saw, not just the conclusion (07/09).
 *
 *  The sweep read `docker inspect` as a boolean, lumping together a stopped container, a removed
 *  one and a probe that did not complete (timeout 124, ssh 255). Session `xe_iJOuWAlKk` was killed
 *  during a `tsc`, got SIGTERM 27 s later and pushed its commit: the container was alive, and the
 *  probe's exit code was recorded nowhere.
 *
 *  `unknown` admits there is no verdict; the caller must write it down. */
export type ContainerProbe = {
  verdict: "alive" | "gone" | "unknown";
  code: number;
  stderr: string;
  ms: number;
};

export async function containerProbe(
  handle: string,
  dockerHost: string | null,
  exec: DockerExec = docker,
): Promise<ContainerProbe> {
  const started = Date.now();
  const r = await exec(
    ["inspect", "-f", "{{.State.Running}}", handle],
    dockerHost,
    DOCKER_PROBE_MS,
  );
  const ms = Date.now() - started;
  const stderr = r.stderr.trim().slice(0, 300);
  const out = r.stdout.trim();
  if (r.code === 0 && out === "true") return { verdict: "alive", code: 0, stderr, ms };
  if (r.code === 0 && out === "false") return { verdict: "gone", code: 0, stderr, ms };
  if (/No such object/i.test(stderr)) return { verdict: "gone", code: r.code, stderr, ms };
  return { verdict: "unknown", code: r.code, stderr, ms };
}

/** The probe in one sentence, for the end reason: what was seen, not what was inferred. */
export function probeVerdict(probe: ContainerProbe | undefined): string {
  if (!probe) return "no runtime handle, cannot probe";
  const took = `${probe.ms} ms`;
  if (probe.verdict === "alive") return `inspect: alive, ${took}`;
  if (probe.verdict === "gone")
    return probe.code === 0 ? `inspect: stopped, ${took}` : `inspect: removed, ${took}`;
  return `PROBE WITHOUT A VERDICT — code ${probe.code} in ${took}: ${probe.stderr || "no output"}`;
}

/** Does the daemon answer? Immediate answer or clear refusal, never a wait.
 *
 *  `exec` is injectable (v52) so tests can prove the "machine not answering" refusal. */
export async function dockerDaemonReachable(
  dockerHost: string | null,
  exec: DockerExec = docker,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const r = await exec(["version", "-f", "{{.Server.Version}}"], dockerHost, DOCKER_PROBE_MS);
  if (r.code === 0 && r.stdout.trim()) return { ok: true };
  if (r.code === 127)
    return { ok: false, why: "the `docker` command is not found on this machine" };
  if (r.code === DOCKER_TIMEOUT_CODE) return { ok: false, why: r.stderr };
  // First useful stderr line, truncated for a toast.
  const first =
    r.stderr
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "unknown cause";
  return { ok: false, why: first.slice(0, 200) };
}

/** Is the image on this daemon? (incident 08/09 19:22) Lets the preflight refuse before
 *  `docker run --pull=never` fails after the slot is reserved. `docker image inspect` is certain:
 *  present or absent, never a delay. */
export async function dockerImagePresent(
  dockerHost: string | null,
  image: string,
  exec: DockerExec = docker,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const r = await exec(
    ["image", "inspect", image, "--format", "{{.Id}}"],
    dockerHost,
    DOCKER_PROBE_MS,
  );
  if (r.code === 0 && r.stdout.trim()) return { ok: true };
  if (r.code === 127)
    return { ok: false, why: "the `docker` command is not found on this machine" };
  if (r.code === DOCKER_TIMEOUT_CODE) return { ok: false, why: r.stderr };
  const first =
    r.stderr
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "unknown cause";
  return { ok: false, why: first.slice(0, 200) };
}
