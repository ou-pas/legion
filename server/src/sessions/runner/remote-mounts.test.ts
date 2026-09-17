// Slice 02 of the multi-machine work (v52, 01/09).
//
// `docker.ts` mounted five paths resolved on the CONTROL PLANE's disk. With
// `DOCKER_HOST=ssh://mini-atelier`, Docker interprets them on the REMOTE host: it creates empty
// folders there, mounts them, and the session starts without repository, Claude state or key. NO
// ERROR IS RAISED, which is what makes the defect costly, and why it is tested on `docker run`'s
// ARGUMENTS rather than on a daemon: the failure was silent, so the proof must be written, not
// observed.
//
//  1. On a remote runner, NO local disk path enters a `-v`. The five mounts become named
//     `legion-*` volumes.
//  2. Secret content enters through STANDARD INPUT. Not an argument (`ps` shows it), not a `-e`
//     (`docker inspect` rereads it for the container's whole life), not a temporary file on the
//     remote host (it survives the failure that prevents removing it).
//  3. A LOCAL runner is FROZEN: the same bind mounts as before, character for character.
//  4. The secrets volume dies with the container; work volumes do NOT, because `destroy` is also
//     the inbox pause gesture, and a workspace `volume rm` there would kill D13.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-remote-mounts-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { DockerRunner } = await import("./docker.js");
const { releaseSessionVolumes, parseVolume, volumeNames, PACKAGE_CACHE_VOLUME } =
  await import("./volumes.js");
const { TASK_STATUS } = await import("../../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../../shared/enums.js");
type Spec = import("./types.js").SessionSpec;

/** A fake docker: records each call WITH its stdin, and always says yes. The stdin is kept as is:
 *  it is exactly what must be asserted about a secret's path. */
function recorder(
  script: (args: string[]) => { code: number; stdout: string; stderr: string } = () => ok(),
) {
  const calls: { args: string[]; stdin?: Buffer }[] = [];
  const exec = (args: string[], _host: string | null, _b: unknown, stdin?: Buffer) => {
    calls.push({ args, stdin });
    return Promise.resolve(script(args));
  };
  return { exec, calls };
}
const ok = (stdout = "cafe1234567890") => ({ code: 0, stdout, stderr: "" });
/** All `docker run` arguments of the SESSION container. The seeding `run` carries `--rm`, the
 *  session's `-d`: that tells them apart without guessing the order. */
const sessionRun = (calls: { args: string[] }[]) =>
  calls.find((c) => c.args[0] === "run" && c.args.includes("-d"))?.args ?? [];
/** The `-v` values of an argument list: what the container sees mounted, nothing else. */
const mountsOf = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === "-v" ? [a] : []));

const LOCAL_WORKSPACE = join(dir, "sessions", "s1", "workspace");
const LOCAL_CLAUDE = join(dir, "sessions", "s1", "claude");
const LOCAL_CACHE = join(dir, "package-cache");
const KEY_PATH = join(dir, "id_test");
const KNOWN_HOSTS_PATH = join(dir, "known_hosts");
const KEY_BYTES =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETSECRET\n-----END OPENSSH PRIVATE KEY-----\n";
writeFileSync(KEY_PATH, KEY_BYTES, { mode: 0o600 });
writeFileSync(KNOWN_HOSTS_PATH, "github.com ssh-ed25519 AAAA\n");

function spec(over: Partial<Spec> = {}): Spec {
  // Deliberate cast: `provision` reads only about TEN of a spec's forty fields, and writing the
  // other thirty would prove nothing more while hiding which ones matter.
  return {
    sessionId: "s1",
    callbackUrl: "http://127.0.0.1:8787",
    claudeStateDir: LOCAL_CLAUDE,
    workspaceDir: LOCAL_WORKSPACE,
    packageCacheDir: LOCAL_CACHE,
    image: null,
    sshKeyPath: null,
    sshKnownHostsPath: null,
    browser: null,
    network: { mode: "open" },
    env: {},
    ...over,
  } as unknown as Spec;
}

describe("AC#1: on a remote runner, no local disk path is mounted anymore", () => {
  it("the five mounts become legion-* volumes", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(
      "ssh://operator@mini-atelier",
      { memoryMb: 2048, cpus: 2 },
      exec,
    ).provision(spec({ sshKeyPath: KEY_PATH, sshKnownHostsPath: KNOWN_HOSTS_PATH }));
    const v = volumeNames("s1");
    assert.deepEqual(mountsOf(sessionRun(calls)), [
      `${v.claudeState}:/claude-state`,
      `${v.workspace}:/workspace`,
      `${PACKAGE_CACHE_VOLUME}:/pkg-cache`,
      `${v.secrets}:/run/legion:ro`,
    ]);
  });

  it("NO argument contains a LEGION_DATA path: the direct statement of the defect", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(
      spec({ sshKeyPath: KEY_PATH, sshKnownHostsPath: KNOWN_HOSTS_PATH }),
    );
    for (const c of calls)
      for (const a of c.args) assert.ok(!a.includes(dir), `a local path leaked into “${a}”`);
  });

  it("and the control plane no longer creates host folders nobody will mount", async () => {
    // A remote session's folders have NO reason to exist on this machine: they were neither
    // mounted, read nor cleaned, and a sweep had to catch them for nothing.
    rmSync(join(dir, "sessions"), { recursive: true, force: true });
    const { exec } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(spec());
    assert.equal(existsSync(LOCAL_WORKSPACE), false);
    assert.equal(existsSync(LOCAL_CLAUDE), false);
  });

  it("the package cache is SHARED: its volume does not carry the session id", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(
      spec({ sessionId: "s2" }),
    );
    assert.ok(mountsOf(sessionRun(calls)).includes(`${PACKAGE_CACHE_VOLUME}:/pkg-cache`));
    assert.ok(
      !PACKAGE_CACHE_VOLUME.includes("s2"),
      "a cache per session would no longer be a cache",
    );
  });
});

describe("AC#2: the secret enters through stdin, and nothing else", () => {
  it("the key content is written to the seeding container's standard input", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(
      spec({ sshKeyPath: KEY_PATH, sshKnownHostsPath: KNOWN_HOSTS_PATH }),
    );
    const seeds = calls.filter((c) => c.args[0] === "run" && c.args.includes("--rm"));
    assert.equal(seeds.length, 2, "one container per secret file");
    assert.equal(seeds[0]!.stdin?.toString(), KEY_BYTES);
    assert.equal(seeds[1]!.stdin?.toString(), "github.com ssh-ed25519 AAAA\n");
  });

  it("the secret appears in NO argument of any call", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(
      spec({ sshKeyPath: KEY_PATH, sshKnownHostsPath: KNOWN_HOSTS_PATH }),
    );
    for (const c of calls)
      for (const a of c.args)
        assert.ok(!a.includes("SECRETSECRET"), `the secret leaked into an argument: “${a}”`);
  });

  it("seeding writes nowhere but the target volume, and has no network", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(
      spec({ sshKeyPath: KEY_PATH }),
    );
    const seed = calls.find((c) => c.args[0] === "run" && c.args.includes("--rm"))!.args;
    assert.deepEqual(mountsOf(seed), [`${volumeNames("s1").secrets}:/seed`]);
    assert.ok(seed.includes("--rm"), "seeding must leave nothing behind");
    assert.deepEqual(seed.slice(seed.indexOf("--network"), seed.indexOf("--network") + 2), [
      "--network",
      "none",
    ]);
    // The only path written is under /seed, i.e. in the volume. Nothing on the host.
    const script = seed.at(-1)!;
    assert.match(script, /^cat > \/seed\/ssh-key && chmod 0444 \/seed\/ssh-key$/);
  });

  it("no `-e` of the session container carries a secret: the spec still goes through the nonce", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(
      spec({ sshKeyPath: KEY_PATH }),
    );
    const args = sessionRun(calls);
    const envs = args.flatMap((a, i) => (args[i - 1] === "-e" ? [a] : []));
    assert.deepEqual(
      envs.map((e) => e.split("=")[0]),
      ["CLAUDE_CONFIG_DIR", "LEGION_SPEC_URL", "LEGION_BOOT", "GIT_SSH_COMMAND"],
    );
    // `GIT_SSH_COMMAND` names the PATH of the copy the entrypoint places; it does not carry the key.
    // Both look alike in a `docker inspect`, and only one of them is a leak.
    const gitSsh = envs.find((e) => e.startsWith("GIT_SSH_COMMAND="))!;
    assert.match(gitSsh, /-i \/home\/agent\/\.ssh\/id_legion/);
    assert.ok(!gitSsh.includes("SECRETSECRET"));
  });

  it("a declared but unreadable key path fails PLAINLY, instead of starting without a key", async () => {
    const { exec } = recorder();
    await assert.rejects(
      () =>
        new DockerRunner("ssh://mini-atelier", undefined, exec).provision(
          spec({ sshKeyPath: join(dir, "missing") }),
        ),
      /ENOENT|missing/,
    );
  });
});

describe("AC#3: a LOCAL runner keeps exactly the previous behaviour", () => {
  it("the bind mounts are the previous ones, character for character", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec).provision(
      spec({ sshKeyPath: KEY_PATH, sshKnownHostsPath: KNOWN_HOSTS_PATH }),
    );
    assert.deepEqual(mountsOf(sessionRun(calls)), [
      `${LOCAL_CLAUDE}:/claude-state`,
      `${LOCAL_WORKSPACE}:/workspace`,
      `${LOCAL_CACHE}:/pkg-cache`,
      `${KEY_PATH}:/run/legion/ssh-key:ro`,
      `${KNOWN_HOSTS_PATH}:/run/legion/known-hosts:ro`,
    ]);
  });

  it("host folders are created, as before: that is what makes reuse possible", async () => {
    rmSync(join(dir, "sessions"), { recursive: true, force: true });
    const { exec } = recorder();
    await new DockerRunner(null, undefined, exec).provision(spec());
    assert.ok(existsSync(LOCAL_WORKSPACE));
    assert.ok(existsSync(LOCAL_CLAUDE));
    assert.ok(existsSync(join(LOCAL_CACHE, "pnpm-store")));
  });

  it("NO volume is created or removed on a local runner", async () => {
    const { exec, calls } = recorder();
    const runner = new DockerRunner(null, undefined, exec);
    await runner.provision(spec({ sshKeyPath: KEY_PATH }));
    await runner.destroy({ id: "s1", runtime: "x" });
    assert.deepEqual(
      calls.filter((c) => c.args[0] === "volume"),
      [],
    );
    assert.deepEqual(
      calls.filter((c) => c.args.includes("--rm")),
      [],
      "no seeding container either",
    );
  });
});

// What the install mode changes for a runner without `dockerHost` (05/09).
//
// The control plane can run INSIDE a container: its paths (`/app/data/…`) then do not exist on
// the host even though the daemon is the machine's. A bind mount would silently create an empty
// folder there, AC#1's silent failure one case earlier. The `local`, `ssh://` clone and `ssh://`
// container cases are pinned here with it: the fix was only meant to move that one cell.
//
// The mode is passed to the constructor; without it, it is read from disk (`.git` present =
// clone), which is the case for every other test in this file: they run in a clone.
describe("AC#5: a local-daemon runner follows the INSTALL MODE", () => {
  it("in container mode, it mounts VOLUMES and no host path", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "docker").provision(
      spec({ sshKeyPath: KEY_PATH, sshKnownHostsPath: KNOWN_HOSTS_PATH }),
    );
    const v = volumeNames("s1");
    assert.deepEqual(mountsOf(sessionRun(calls)), [
      `${v.claudeState}:/claude-state`,
      `${v.workspace}:/workspace`,
      `${PACKAGE_CACHE_VOLUME}:/pkg-cache`,
      `${v.secrets}:/run/legion:ro`,
    ]);
    // The direct statement of the defect: no path of this machine goes to the daemon.
    for (const c of calls)
      for (const a of c.args) assert.ok(!a.includes(dir), `a local path leaked into “${a}”`);
  });

  it("in container mode, it no longer creates host folders nobody will mount", async () => {
    rmSync(join(dir, "sessions"), { recursive: true, force: true });
    const { exec } = recorder();
    await new DockerRunner(null, undefined, exec, "docker").provision(spec());
    assert.equal(existsSync(LOCAL_WORKSPACE), false);
    assert.equal(existsSync(LOCAL_CLAUDE), false);
  });

  it("in container mode, the secrets volume dies with the container, as on a remote runner", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "docker").destroy({ id: "s1", runtime: "x" });
    assert.deepEqual(
      calls.filter((c) => c.args[0] === "volume").map((c) => c.args),
      [["volume", "rm", volumeNames("s1").secrets]],
    );
  });

  it("in CLONE mode, the same runner mounts paths: the common case is unchanged", async () => {
    // This test protects the developer machine: `tsx watch` in the clone, local socket, workspace
    // inspectable by hand. An over-eager fix would break it.
    const { exec, calls } = recorder();
    await new DockerRunner(null, undefined, exec, "bare").provision(
      spec({ sshKeyPath: KEY_PATH, sshKnownHostsPath: KNOWN_HOSTS_PATH }),
    );
    assert.deepEqual(mountsOf(sessionRun(calls)), [
      `${LOCAL_CLAUDE}:/claude-state`,
      `${LOCAL_WORKSPACE}:/workspace`,
      `${LOCAL_CACHE}:/pkg-cache`,
      `${KEY_PATH}:/run/legion/ssh-key:ro`,
      `${KNOWN_HOSTS_PATH}:/run/legion/known-hosts:ro`,
    ]);
    assert.deepEqual(
      calls.filter((c) => c.args[0] === "volume"),
      [],
    );
  });

  it("an `ssh://` runner is identical in both modes", async () => {
    const runs: string[][] = [];
    for (const mode of ["bare", "docker"] as const) {
      const { exec, calls } = recorder();
      await new DockerRunner("ssh://mini-atelier", undefined, exec, mode).provision(
        spec({ sshKeyPath: KEY_PATH }),
      );
      runs.push(mountsOf(sessionRun(calls)));
    }
    assert.deepEqual(runs[0], runs[1]);
    assert.ok(
      runs[0]!.every((m) => m.startsWith("legion-")),
      "a remote runner never mounted a path",
    );
  });
});

describe("AC#4: the volume lifecycle", () => {
  it("`destroy` removes the SECRETS volume and LEAVES the work ones: `destroy` is also the pause", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).destroy({
      id: "s1",
      runtime: "x",
    });
    const v = volumeNames("s1");
    assert.deepEqual(
      calls.filter((c) => c.args[0] === "volume").map((c) => c.args),
      [["volume", "rm", v.secrets]],
    );
  });

  it("the pre-start sweep removes the previous run's secrets volume", async () => {
    const { exec, calls } = recorder();
    await new DockerRunner("ssh://mini-atelier", undefined, exec).provision(spec());
    const removed = calls
      .filter((c) => c.args[0] === "volume" && c.args[1] === "rm")
      .map((c) => c.args[2]);
    assert.deepEqual(removed, [volumeNames("s1").secrets]);
  });

  it("`releaseSessionVolumes` takes the three volumes of a REMOTE runner session", async () => {
    seedRows("ssh://mini-atelier");
    const { exec, calls } = recorder();
    assert.equal(await releaseSessionVolumes(["sv1"], exec), 3);
    const v = volumeNames("sv1");
    assert.deepEqual(
      calls.map((c) => c.args),
      [
        ["volume", "rm", v.workspace],
        ["volume", "rm", v.claudeState],
        ["volume", "rm", v.secrets],
      ],
    );
  });

  it("and nothing at all for a LOCAL runner session: its files are folders", async () => {
    seedRows(null);
    const { exec, calls } = recorder();
    assert.equal(await releaseSessionVolumes(["sv1"], exec), 0);
    assert.deepEqual(calls, []);
  });

  it("…EXCEPT in container mode, where the same local runner does have volumes to release", async () => {
    // Without this, switching the mount mode would create volumes nobody reclaims, on the disk the
    // control plane SHARES with its sessions.
    seedRows(null);
    const { exec, calls } = recorder();
    assert.equal(await releaseSessionVolumes(["sv1"], exec, "docker"), 3);
    const v = volumeNames("sv1");
    assert.deepEqual(
      calls.map((c) => c.args),
      [
        ["volume", "rm", v.workspace],
        ["volume", "rm", v.claudeState],
        ["volume", "rm", v.secrets],
      ],
    );
  });

  it("a `volume rm` refused because the volume is IN USE does not fail the release", async () => {
    // That is docker's RIGHT answer while a session still lives: the safe side of the error is
    // keeping disk, never taking away someone's unpushed work.
    seedRows("ssh://mini-atelier");
    const { exec } = recorder(() => ({ code: 1, stdout: "", stderr: "volume is in use" }));
    assert.equal(await releaseSessionVolumes(["sv1"], exec), 0);
  });

  it("`parseVolume` recognises the three roles, and the shared cache belongs to nobody", () => {
    assert.deepEqual(parseVolume("legion-workspace-abc"), { role: "workspace", sessionId: "abc" });
    assert.deepEqual(parseVolume("legion-claude-abc"), { role: "claude-state", sessionId: "abc" });
    assert.deepEqual(parseVolume("legion-secrets-abc"), { role: "secrets", sessionId: "abc" });
    // `sessionId: null` keeps it out of orphan marking, hence out of cleanup. `"autre"` is the
    // `VolumeRole` value declared in `volumes.ts`, a contract string, not decor.
    assert.deepEqual(parseVolume(PACKAGE_CACHE_VOLUME), { role: "autre", sessionId: null });
    assert.deepEqual(parseVolume("legion-browser-net-r1"), { role: "autre", sessionId: null });
  });
});

/** A session `sv1` on a runner with the requested docker host. */
function seedRows(dockerHost: string | null): void {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: "p1", name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: "a1", projectId: "p1", name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners)
    .values({ id: "r1", name: "r1", kind: RUNNER_KIND.docker, dockerHost })
    .run();
  db.insert(schema.tasks)
    .values({
      id: "t1",
      projectId: "p1",
      name: "t",
      status: TASK_STATUS.done,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: "sv1",
      taskId: "t1",
      agentId: "a1",
      runnerId: "r1",
      model: "m",
      status: "destroyed",
      callbackToken: "k",
      startedAt: now,
    })
    .run();
}

// Guarantees the sessions root before the first local test: `provision` creates it, but test
// order must not decide what passes.
mkdirSync(join(dir, "sessions"), { recursive: true });
