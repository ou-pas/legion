// ProcessRunner — dev fallback: runs the session-runner as a plain child process.
// NO network isolation (a "limited" environment is announced but NOT enforced here —
// dev only, the event stream carries an explicit warning). Same contract as Docker.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Runner, RunnerHandle, SessionSpec } from "./types.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The payload is TypeScript since lot 10 (10/09). The session image gets compiled `.mjs` at
// build time, but this runner has no image: it runs the source as it is on the operator's disk.
//
// `import.meta.resolve` rather than `--import tsx`: Node resolves a bare specifier from the
// spawned process's CWD, which is the session workspace, outside the repository, where `tsx` is
// not findable. Resolved here it is an absolute URL, the same `tsx` the dev server runs under.
const PAYLOAD = path.resolve(HERE, "../../../../runner-payload/session-runner.mts");
const TSX_LOADER = import.meta.resolve("tsx");

const procs = new Map<string, ChildProcess>();

export class ProcessRunner implements Runner {
  readonly kind = "process" as const;

  async provision(spec: SessionSpec): Promise<RunnerHandle> {
    fs.mkdirSync(spec.claudeStateDir, { recursive: true });
    // Isolated HOME + workdir per session (review P4 #9): git config/credentials written
    // by the session must NEVER touch the operator's real ~/.gitconfig or ~/.git-credentials.
    const sessionRoot = path.dirname(spec.claudeStateDir);
    const home = path.join(sessionRoot, "home");
    // The spec's workdir (`workspace/`), no longer a `work/` invented here. This runner already
    // kept its folder between runs (D13 without knowing it) but under a name the boot sweep did
    // not know: the disk was never reclaimed, and a wake-up hit `git clone` in a non-empty folder.
    const work = spec.workspaceDir;
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(work, { recursive: true });
    const child = spawn("node", ["--import", TSX_LOADER, PAYLOAD], {
      env: {
        ...process.env,
        // No `...spec.env`: the session-runner sets credentials in its own environment from the
        // spec, one mechanism whatever the runner. The spec still goes through the environment
        // in this dev runner: there is no container, so nothing to reveal to `docker inspect`.
        LEGION_SPEC: JSON.stringify(spec),
        CLAUDE_CONFIG_DIR: spec.claudeStateDir,
        HOME: home,
        LEGION_WORKDIR: work,
      },
      cwd: work,
      stdio: ["ignore", "inherit", "inherit"],
    });
    procs.set(spec.sessionId, child);
    return { id: spec.sessionId, runtime: String(child.pid ?? "?") };
  }

  async wait(handle: RunnerHandle): Promise<{ exitCode: number }> {
    const child = procs.get(handle.id);
    if (!child) return { exitCode: 1 };
    return new Promise((resolve) => {
      child.on("close", (code) => resolve({ exitCode: code ?? 1 }));
      if (child.exitCode !== null) resolve({ exitCode: child.exitCode });
    });
  }

  async destroy(handle: RunnerHandle): Promise<void> {
    const child = procs.get(handle.id);
    if (child && child.exitCode === null) child.kill("SIGKILL");
    procs.delete(handle.id);
  }
}
