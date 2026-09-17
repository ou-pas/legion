// DockerRunner — one throwaway container per session.
// "limited" environments get the egress wall: an `internal` docker network with no
// outside route, plus a tinyproxy sidecar enforcing the domain allowlist. The session
// reaches Anthropic AND the control plane only through that proxy.
import fs from "node:fs";
import {
  DOCKER_QUICK_MS,
  DOCKER_START_MS,
  DOCKER_STOP_GRACE_S,
  DOCKER_STOP_MS,
  type DockerExec,
  docker,
  dockerDaemonReachable,
} from "../../shared/docker-exec.js";
import { dropSpecs, stageSpec } from "./boot.js";
import { ensureBrowserService } from "./browser-service.js";
import { holdHostAwake } from "./caffeinate.js";
import { sessionFilesAreVolumes } from "./mount-mode.js";
import {
  PACKAGE_CACHE_VOLUME,
  SECRETS_MOUNT,
  SECRET_KNOWN_HOSTS,
  SECRET_SSH_KEY,
  removeVolumes,
  seedSecretVolume,
  volumeNames,
} from "./volumes.js";
import { dockerWaitOnce, waitWithReattach } from "./wait-reattach.js";
import { ensureMountDirs } from "./workspace.js";
import type { Runner, RunnerHandle, SessionSpec } from "./types.js";
import type { SessionResources } from "../../infra/runner/limits.js";
import type { RuntimeMode } from "../../updates/stamp.js";
// The proxy tag comes from the fleet image catalogue, like the browser's: the same tag the update
// rebuilds and the Infra screen watches (`fleet-images.ts`).
import { PROXY_IMAGE, SESSION_IMAGE as IMAGE } from "../../infra/fleet-images.js";
import { createLogger } from "../../shared/log.js";

// The session's fate (started, refused, orphaned) is written by `manager.ts` to `control_events`.
// What is logged here is the docker detail of a partly failed gesture, read in the terminal while
// looking at the problem.
const log = createLogger("docker");

/** Where the project key is placed in the container, and where the entrypoint looks for it. NOT
 *  the path `ssh` reads: see the mount below, and `session-image/entrypoint.sh`. */
const MOUNTED_KEY = "/run/legion/ssh-key";
/** Where the entrypoint drops the usable copy. Both constants live here AND in the entrypoint: the
 *  price of a contract crossing a docker image. */
const AGENT_KEY = "/home/agent/.ssh/id_legion";
/** The operator's `known_hosts`, mounted and copied the same way. `ssh` reads it at
 *  `~/.ssh/known_hosts`, its natural place: no option to pass, so none to forget. */
const MOUNTED_KNOWN_HOSTS = "/run/legion/known-hosts";

const names = (id: string) => ({
  session: `legion-session-${id}`,
  proxy: `legion-proxy-${id}`,
  network: `legion-net-${id}`,
});

/** A key is a few kilobytes. Same ceiling as `sshKeyOf` on the manager side, for the same reason:
 *  a hand-typed path can point at `/dev/zero`. */
const MAX_SECRET_BYTES = 64 * 1024;

/**
 * Hardening shared by a session's two containers (05/09).
 *
 * They only had `--memory` and `--cpus`: resource ceilings, no limit on power. A default Docker
 * container keeps some fifteen kernel capabilities (`CAP_CHOWN`, `CAP_SETUID`, `CAP_NET_RAW`…)
 * that neither the session nor the proxy uses.
 *
 *  · `--cap-drop=ALL`: checked on both images rather than assumed. The session runs as `agent`,
 *    its entrypoint only copies a key into its own HOME, and git/node/pnpm/make ask nothing of the
 *    kernel. The proxy listens on 8888 (above 1024) as an unprivileged user. Nothing to
 *    `--cap-add`, and that is the outcome of a trial, not a hope.
 *  · `--security-opt no-new-privileges`: a `setuid` binary found in the image can no longer be
 *    used to escalate. That makes the images' `USER` irreversible.
 *  · `--pids-limit`: a fork bomb, or a `pnpm install` gone wrong, filled the HOST's PID table. We
 *    paid for that from the other end in September with nine thousand orphaned `ssh` processes
 *    (see `docker-exec.ts`).
 *
 * The number was measured, not estimated (14/09). "512 is plenty for a session compiling a
 * monorepo" was the original estimate and it was wrong: `pids.max` counts TASKS, i.e. threads.
 * Node opens about ten per process, and `node --test` starts as many as the host has cores,
 * knowing nothing of the container's budget. On task `Ca1_y6TPu-` the agent diagnosed its own cage
 * (`cat /sys/fs/cgroup/pids.max` → 512), then the process died on SIGABRT and the final `git push`
 * could not even fork: `spawn git EAGAIN`.
 *
 * Running the project suite is the check Legion REQUIRES from its agents (`CHECKS`,
 * projects/seed/self.ts); a ceiling that makes it impossible is a badly set ceiling. 2048 still
 * stops those nine thousand orphans four times earlier than the host's PID table.
 */
const HARDENING = ["--cap-drop=ALL", "--security-opt", "no-new-privileges", "--pids-limit=2048"];

export class DockerRunner implements Runner {
  readonly kind = "docker" as const;
  /** Resources come from the RUNNER row (v38). `docker.ts` applies, it does not decide; the
   *  default exists only for test calls.
   *
   *  `exec` (v52) is the injection seam for docker calls, like `browser-service.ts` has since v30:
   *  provisioning is the only place in the server that decides what gets mounted into a session,
   *  and that is checked on ARGUMENTS, not on a daemon.
   *
   *  `mode` (05/09) is for tests only: left empty, the install mode is read from disk by
   *  `sessionFilesAreVolumes`, so every construction site (including `manager.ts`'s two `destroy`
   *  calls) gets it right without thinking about it. */
  constructor(
    private dockerHost: string | null = null,
    private resources: SessionResources = { memoryMb: 1024, cpus: 1 },
    private exec: DockerExec = docker,
    private mode?: RuntimeMode,
  ) {}

  /** `true` when the session's files cannot be paths on this machine: the one question separating
   *  the two paths. It used to be "is the daemon remote?", which missed a control plane running
   *  inside a container; see `mount-mode.ts` for the silent failure that produced. */
  private get usesVolumes(): boolean {
    return sessionFilesAreVolumes(this.dockerHost, this.mode);
  }

  async provision(spec: SessionSpec): Promise<RunnerHandle> {
    const n = names(spec.sessionId);
    // Host folders only exist on the local path. On a remote runner these lines created empty
    // folders on the CONTROL PLANE's disk (never mounted, read or cleaned) while Docker created
    // other empty ones on the remote host.
    if (!this.usesVolumes) {
      fs.mkdirSync(spec.claudeStateDir, { recursive: true });
      // D13 + D14: same recipe as `claudeStateDir` above, a host folder created by the control
      // plane and bind-mounted. It already works with a container running as `agent`; reused
      // rather than inventing another (Q-B of the spec).
      ensureMountDirs(spec);
    }

    const run = await this.withBrowserIfReachable(spec);

    // The spec does NOT go into the container's environment: it holds the auth token, granted
    // secrets and resolved MCP headers, and any `docker inspect` read them. The container gets a
    // URL and a single-use nonce (see boot.ts) and fetches its spec at startup.
    const boot = stageSpec(run.sessionId, run);
    const args = [
      "run",
      "-d",
      "--name",
      n.session,
      // `--pull=never` (v40), a direct consequence of per-project images. A missing image used to
      // trigger a `pull`: harmless for `legion-session:latest`, which is built locally and whose
      // absence the Infra page already names, but bad for a name typed into a screen, which then
      // goes looking for a remote registry and, on a limited network, hangs until the timeout.
      // We want the immediate failure, which docker names itself: "image not found locally".
      "--pull=never",
      `--memory=${this.resources.memoryMb}m`,
      `--cpus=${this.resources.cpus}`,
      ...HARDENING,
      "-e",
      "CLAUDE_CONFIG_DIR=/claude-state",
      "-e",
      `LEGION_SPEC_URL=${run.callbackUrl}/internal/sessions/${run.sessionId}/spec`,
      "-e",
      `LEGION_BOOT=${boot}`,
    ];

    // Names are deterministic, so they can be taken. A session resumes under its own id (inbox
    // pause → destroy → resume), so `legion-session-<id>` and `legion-proxy-<id>` were already
    // used. If the pause cleanup failed (`docker rm -f` over budget, busy daemon), the resume hit
    // "The container name is already in use". It happened on 25/08 on an interview: two rounds
    // answered, 51 minutes, and the session dead at the second wake-up.
    //
    // A container carrying THIS name is by construction a leftover of THIS session: remove it
    // before creating. Idempotent, like the network creation that tolerates "already exists".
    await this.sweepNames(run.sessionId);

    // AFTER the sweep, and the order matters: on the volume path `mounts` SEEDS the secrets
    // volume that `sweepNames` just removed. A resume therefore never reuses a key placed by the
    // previous run; it places one again from the control plane's disk, the only source of truth.
    args.push(...(await this.mounts(run)));

    if (run.network.mode === "limited") {
      // 1. internal network (no gateway to the outside — the actual wall)
      let r = await this.exec(
        ["network", "create", "--internal", n.network],
        this.dockerHost,
        DOCKER_QUICK_MS,
      );
      if (r.code !== 0 && !r.stderr.includes("already exists"))
        throw new Error(`network create failed: ${r.stderr.slice(0, 300)}`);
      // 2. proxy sidecar: bridge (egress) + internal (reachable by the session).
      //    Allowlist = environment hosts + Anthropic API + the control plane host.
      const callbackHost = new URL(run.callbackUrl).hostname;
      const allow = [
        ...new Set([...run.network.allowedHosts, "api.anthropic.com", callbackHost]),
      ].join(",");
      r = await this.exec(
        ["run", "-d", "--name", n.proxy, ...HARDENING, "-e", `ALLOWED_HOSTS=${allow}`, PROXY_IMAGE],
        this.dockerHost,
        DOCKER_START_MS,
      );
      if (r.code !== 0) {
        await this.destroy({ id: run.sessionId, runtime: "" }).catch(() => {});
        throw new Error(`proxy run failed: ${r.stderr.slice(0, 300)}`);
      }
      r = await this.exec(
        ["network", "connect", n.network, n.proxy],
        this.dockerHost,
        DOCKER_QUICK_MS,
      );
      if (r.code !== 0) {
        await this.destroy({ id: run.sessionId, runtime: "" }).catch(() => {});
        throw new Error(`network connect failed: ${r.stderr.slice(0, 300)}`);
      }
      const proxyUrl = `http://${n.proxy}:8888`;
      args.push(
        "--network",
        n.network,
        "-e",
        `HTTPS_PROXY=${proxyUrl}`,
        "-e",
        `HTTP_PROXY=${proxyUrl}`,
        "-e",
        `https_proxy=${proxyUrl}`,
        "-e",
        `http_proxy=${proxyUrl}`,
        "-e",
        `LEGION_PROXY=${proxyUrl}`, // session-runner routes its callbacks through it too
      );
    }

    // v40: how git calls ssh. Passed as `-e` rather than in `run.env` because it is not a
    // credential (nothing to hide from `docker inspect`), and the `ProxyCommand` half depends on
    // the proxy container name, computed HERE.
    //
    // `IdentitiesOnly=yes`: without it ssh offers the agent's and HOME's keys first, tries several,
    // and a forge ends up answering "Too many authentication failures".
    //
    // The proxy is not a mandatory hop for SSH (operator's decision, 27/08). On an open network
    // (the default) there is no `ProxyCommand`. It only appears on a limited network, where the
    // container has no direct route: without it a limited environment would be a dead end for
    // SSH, and the remedy would be widening the network, the opposite of what we want.
    if (run.sshKeyPath) {
      // `StrictHostKeyChecking=yes` is already the effective behaviour without a tty; writing it
      // makes it readable in `docker inspect` and stops a future `accept-new` from slipping in
      // unseen. Server fingerprints are in the image (`/etc/ssh/ssh_known_hosts`), completed by
      // the operator's `known_hosts` when there is one next to the key.
      const opts = [`-i ${AGENT_KEY}`, "-o IdentitiesOnly=yes", "-o StrictHostKeyChecking=yes"];
      if (run.network.mode === "limited")
        // `nc -X connect -x <proxy>` speaks CONNECT, which tinyproxy allows on port 22. The quotes
        // are for the `sh -c` git passes the variable through.
        opts.push(`-o ProxyCommand="nc -X connect -x ${n.proxy}:8888 %h %p"`);
      args.push("-e", `GIT_SSH_COMMAND=ssh ${opts.join(" ")}`);
    }

    // No `-e` loop over run.env: credentials arrive with the spec and the session-runner sets
    // them in ITS environment, invisible to `docker inspect`, which only shows the container's
    // creation config.
    args.push(run.image ?? IMAGE);
    const { code, stdout, stderr } = await this.exec(args, this.dockerHost, DOCKER_START_MS);
    if (code !== 0) {
      await this.destroy({ id: run.sessionId, runtime: "" }).catch(() => {});
      throw new Error(`docker run failed: ${(stderr || stdout).slice(0, 400)}`);
    }
    // Second network: the shared browser's. `docker network connect` adds to existing networks
    // (bridge OR legion-net-<id> in limited mode, both coexist). Best effort: a session without a
    // browser beats no session; the runner finds the dead endpoint on connect and reports it.
    if (run.browser) {
      const r = await this.exec(
        ["network", "connect", run.browser.network, n.session],
        this.dockerHost,
        DOCKER_QUICK_MS,
      );
      if (r.code !== 0)
        log.warn("connecting to the browser network failed", {
          container: n.session,
          stderr: r.stderr.slice(0, 200),
        });
    }
    return { id: run.sessionId, runtime: stdout.trim().slice(0, 12) };
  }

  /** The shared browser, or nothing (v30): the service is ensured BEFORE freezing the spec. If it
   *  does not start, the session goes WITHOUT a browser (spec.browser and endpoint removed) rather
   *  than not at all: it is a verification tool, not a dependency. The removal must precede
   *  `stageSpec`, which freezes the spec served at boot.
   *
   *  Returns a spec, mutates none: the caller holds the same object as `runLifecycle`, and writing
   *  into it would make its reading depend on when it happens. */
  private async withBrowserIfReachable(spec: SessionSpec): Promise<SessionSpec> {
    if (!spec.browser) return spec;
    try {
      await ensureBrowserService(
        { container: spec.browser.service, network: spec.browser.network },
        this.dockerHost,
      );
      return spec;
    } catch (err) {
      log.warn("shared browser unavailable — session started without it", {
        sessionId: spec.sessionId,
        error: (err as Error).message,
      });
      const env = { ...spec.env };
      delete env.BROWSER_WS_ENDPOINT;
      return { ...spec, browser: null, env };
    }
  }

  async wait(handle: RunnerHandle): Promise<{ exitCode: number; oomKilled: boolean }> {
    const container = names(handle.id).session;
    // No ceiling, the only such call in the project: `docker wait` waits for an EVENT (container
    // exit) that comes in two minutes or six hours. A ceiling would kill the session at the
    // deadline; the first version of this lot did, cutting three sessions at exactly 120 s.
    //
    // And no conclusion on a broken pipe (01/09, multi-machine slice 05). This wait holds an ssh
    // connection for the session's whole life: on a remote runner, breaking it says nothing about
    // the session. `wait-reattach.ts` tells the difference and reattaches to the same container,
    // keeping the host awake meanwhile, since a sleeping machine freezes a container without
    // Docker saying a word.
    const awake = holdHostAwake(this.dockerHost);
    let exitCode: number;
    try {
      exitCode = await waitWithReattach(
        () => dockerWaitOnce(container, this.dockerHost),
        async () => (await dockerDaemonReachable(this.dockerHost)).ok,
        { container },
      );
    } finally {
      awake();
    }
    // The container still exists here (`destroy` comes after): the only window where Docker can
    // still say WHY it exited. `docker wait` returns an integer, and 137 looks like any other
    // failure. `State.OOMKilled` is the only source that tells an OOM kill from a program failure.
    const oomKilled = exitCode !== 0 ? await this.wasOomKilled(handle.id) : false;
    return { exitCode, oomKilled };
  }

  private async wasOomKilled(sessionId: string): Promise<boolean> {
    const r = await this.exec(
      ["inspect", "-f", "{{.State.OOMKilled}}", names(sessionId).session],
      this.dockerHost,
      DOCKER_QUICK_MS,
    ).catch(() => null);
    // Container already swept, daemon not answering: we do not KNOW, so we say nothing. Claiming
    // an OOM on a missing answer would be worse than the old "code 1".
    return r?.code === 0 && r.stdout.trim() === "true";
  }

  /**
   * The five mounts, and the two ways to make them (v52, multi-machine work).
   *
   * Filesystem SHARED with the daemon (git clone, this machine's socket): exactly the previous
   * bind mounts. All workspace reuse (`workspace.ts`) is built on them.
   *
   * Otherwise: named `legion-*` volumes. A control-plane path the daemon cannot resolve designates
   * nothing: Docker creates an empty folder of that name WHERE IT RUNS, mounts it, and the session
   * starts without repository, Claude state or key, with no error raised. True of a remote daemon
   * (v52) as of a containerised control plane talking to its own machine's daemon (05/09);
   * `mount-mode.ts` holds the criterion joining them.
   *
   * See `volumes.ts` for what a volume inherits from the image (permissions included) and for
   * seeding the only mount that carries content.
   */
  private async mounts(spec: SessionSpec): Promise<string[]> {
    const args: string[] = [];
    if (this.usesVolumes) {
      const v = volumeNames(spec.sessionId);
      // D13 and D14 as volumes. BOTH paths mount at the same container locations, which lets the
      // image, entrypoint and payload ignore the difference.
      args.push("-v", `${v.claudeState}:/claude-state`, "-v", `${v.workspace}:/workspace`);
      if (spec.packageCacheDir) args.push("-v", `${PACKAGE_CACHE_VOLUME}:/pkg-cache`);
      const secrets = this.readSecrets(spec);
      if (secrets.length) {
        await seedSecretVolume(v.secrets, spec.image ?? IMAGE, secrets, {
          dockerHost: this.dockerHost,
          exec: this.exec,
        });
        // `:ro` for the same reason as locally: nothing in the session should write there, and it
        // is the only link between the container and an operator secret.
        args.push("-v", `${v.secrets}:${SECRETS_MOUNT}:ro`);
      }
      return args;
    }

    args.push("-v", `${spec.claudeStateDir}:/claude-state`);
    // D13: the working directory survives the pause's `docker rm`. "Ephemeral" never meant
    // throwing the work away: the container stays disposable, its 640 MB of dependencies stop
    // being so.
    args.push("-v", `${spec.workspaceDir}:/workspace`);
    // D14: the SHARED package cache. The settings using it (`npm_config_store_dir` and
    // `npm_config_cache`) are in the image: the mount only swaps an empty folder for a warm one.
    // Without it the image keeps working on its local /pkg-cache, the safe side of the error.
    if (spec.packageCacheDir) args.push("-v", `${spec.packageCacheDir}:/pkg-cache`);

    // v40: the SSH key, mounted read-only, at a path that is NOT the one ssh reads.
    //
    // The mount carries the HOST uid. `ssh` refuses a key owned by neither root nor the current
    // user, so mounting it straight at `~/.ssh/id_legion` would give a systematic "bad ownership
    // or modes" with no guessable remedy. The image entrypoint copies it at 0600 into `agent`'s
    // HOME; here we only place it.
    if (spec.sshKeyPath) args.push("-v", `${spec.sshKeyPath}:${MOUNTED_KEY}:ro`);
    if (spec.sshKnownHostsPath)
      args.push("-v", `${spec.sshKnownHostsPath}:${MOUNTED_KNOWN_HOSTS}:ro`);
    return args;
  }

  /** Read from the control plane's disk, the only place the secrets exist. A declared but
   *  unreadable path is NOT silently ignored: `sshKeyOf` (manager.ts) already catches that at
   *  preflight, and letting it through would give a session failing its clone on "Permission
   *  denied (publickey)" six seconds and one model turn later. */
  private readSecrets(spec: SessionSpec): { name: string; content: Buffer }[] {
    const out: { name: string; content: Buffer }[] = [];
    for (const [path, name] of [
      [spec.sshKeyPath, SECRET_SSH_KEY],
      [spec.sshKnownHostsPath, SECRET_KNOWN_HOSTS],
    ] as const) {
      if (!path) continue;
      const stat = fs.statSync(path);
      if (!stat.isFile() || stat.size > MAX_SECRET_BYTES)
        throw new Error(
          `secret “${name}” refused: ${path} is not a file smaller than ${MAX_SECRET_BYTES} bytes`,
        );
      out.push({ name, content: fs.readFileSync(path) });
    }
    return out;
  }

  /** Separate from `destroy` because the intent differs: `destroy` ends a live session, this
   *  prepares the ground for one that starts. Errors are swallowed but not silently: a leftover
   *  that could not be removed shows plainly at the next `run`. */
  private async sweepNames(sessionId: string): Promise<void> {
    const n = names(sessionId);
    for (const name of [n.session, n.proxy]) {
      const r = await this.exec(["rm", "-f", name], this.dockerHost, DOCKER_QUICK_MS).catch(
        () => null,
      );
      if (r && r.code !== 0 && !/No such container/i.test(r.stderr))
        log.warn("leftover not removed", {
          container: name,
          stderr: r.stderr.trim().slice(0, 200),
        });
    }
    // The secrets volume is a leftover like the others, and the most urgent: a key placed by the
    // previous run has no business serving the next. Removed here, there is no window where the
    // container is gone but the key lingers.
    if (this.usesVolumes)
      await removeVolumes([volumeNames(sessionId).secrets], this.dockerHost, this.exec);
  }

  async destroy(handle: RunnerHandle): Promise<void> {
    const n = names(handle.id);
    // A container that never started would leave its spec pending until the TTL.
    dropSpecs(handle.id);

    // Ask before forcing (05/09). `rm -f` is a SIGKILL: the runtime gets no time to push what it
    // just did, so an operator-requested stop threw away the work of the session it stopped.
    // `docker stop` sends SIGTERM and waits.
    //
    // This would have done nothing before: `node` is PID 1 in the image (the entrypoint ends with
    // `exec "$@"`), and the kernel does NOT deliver a default-action signal to a PID 1 without a
    // handler. The runtime has one now (`runner-payload/session-runner.mts`): it pushes and exits.
    //
    // The `rm -f` below stays: it removes the stopped container, and settles the case where the
    // grace period was not enough. On an exited container `stop` is a no-op.
    const stopped = await this.exec(
      ["stop", "-t", String(DOCKER_STOP_GRACE_S), n.session],
      this.dockerHost,
      DOCKER_STOP_MS,
    ).catch(() => null);
    if (stopped && stopped.code !== 0 && !/No such container/i.test(stopped.stderr))
      log.warn("stop refused", {
        container: n.session,
        stderr: stopped.stderr.trim().slice(0, 200),
      });

    // Ephemeral rule: nothing survives except git, callbacks, and the mounted state dir.
    // Failures stay non-fatal (a throwing destroy would prevent a clean session close) but they
    // are no longer SILENT: a `.catch(() => {})` on this `rm -f` left a proxy standing and killed a
    // resume at the next wake-up (25/08).
    for (const args of [
      ["rm", "-f", n.session],
      ["rm", "-f", n.proxy],
      ["network", "rm", n.network],
    ]) {
      const r = await this.exec(args, this.dockerHost, DOCKER_QUICK_MS).catch(() => null);
      if (r && r.code !== 0 && !/No such (container|network)|not found/i.test(r.stderr))
        log.warn("cleanup refused", {
          command: args.join(" "),
          stderr: r.stderr.trim().slice(0, 200),
        });
    }
    // The secrets volume dies with the container. The other two do not, deliberately.
    //
    // `destroy` runs in `runLifecycle`'s `finally` on EVERY exit, including the inbox pause (it is
    // what defines the pause: waiting = no container). Removing the workspace volume here would
    // kill D13 on remote runners: every wake-up would re-clone and reinstall 640 MB. Work volumes
    // follow the same path as local folders (`workspace.ts` → `releaseSessionVolumes`), which
    // knows a pause from an end.
    //
    // The key has no reason to survive: the next run places one again, and a secret lingering on
    // a remote machine between sessions is exposure time gained for nothing.
    if (this.usesVolumes)
      await removeVolumes([volumeNames(handle.id).secrets], this.dockerHost, this.exec);
  }
}
