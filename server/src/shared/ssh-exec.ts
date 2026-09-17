// One command on a remote host over ssh (02/09, usage probe). The second place assuming an ssh
// shell on a fleet machine; read `sessions/runner/caffeinate.ts`'s header first, same rule.
//
// Open, read, close, like `docker()` (`shared/docker-exec.ts`), with the same precaution: on the
// night of 01→02/09 a timeout that killed only the CLI left orphaned `ssh` children that filled the
// control plane container's PID table (9 000 processes) on two sleeping machines. SIGKILL goes to
// the whole process group.
//
// Tolerant: a non-Mac host, a missing command or a refusing ssh returns a non-zero code and
// stderr; the caller (machine metrics) decides what to say.
import { spawn } from "node:child_process";
import { sshTargetOf } from "./ssh-target.js";

export type SshResult = { code: number; stdout: string; stderr: string };

/** Budget for a short measuring command (`uptime`, `vm_stat`). Shorter than `DOCKER_PROBE_MS`: no
 *  daemon to wake. */
export const SSH_METRICS_MS = 8_000;

/** The real `ssh`, injectable for tests like `docker()`. */
export type SshExec = (
  dockerHost: string,
  remoteCommand: string,
  budgetMs: number,
) => Promise<SshResult>;

/** Not an ssh:// host returns 127: no remote shell, not a failure (see `sshTargetOf`). */
export const sshExec: SshExec = (dockerHost, remoteCommand, budgetMs) => {
  const t = sshTargetOf(dockerHost);
  if (!t) return Promise.resolve({ code: 127, stdout: "", stderr: "not an ssh:// host" });
  // Half the budget at most for connecting; the rest runs the command.
  const connectTimeoutS = Math.max(1, Math.floor(budgetMs / 2000));
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${connectTimeoutS}`,
    ...(t.port ? ["-p", t.port] : []),
    t.target,
    remoteCommand,
  ];
  return new Promise((resolve) => {
    // `detached`, as in `docker()`: killing `ssh` alone would leave its connection fork running,
    // the fork that filled the PID table.
    const p = spawn("ssh", args, { detached: true });
    let stdout = "",
      stderr = "",
      done = false;
    const settle = (r: SshResult) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        if (p.pid) process.kill(-p.pid, "SIGKILL");
        else p.kill("SIGKILL");
      } catch {
        p.kill("SIGKILL");
      }
      settle({
        code: 124,
        stdout,
        stderr: `ssh did not answer in ${Math.round(budgetMs / 1000)} s`,
      });
    }, budgetMs);
    timer.unref?.();
    p.stdout.on("data", (d: Buffer) => {
      stdout += String(d);
    });
    p.stderr.on("data", (d: Buffer) => {
      stderr += String(d);
    });
    p.on("error", (e) => settle({ code: 127, stdout: "", stderr: String(e) }));
    p.on("close", (code) => settle({ code: code ?? 1, stdout, stderr }));
  });
};
