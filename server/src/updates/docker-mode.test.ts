// Updating when running in an image (01/09, slice 08).
//
// No Docker daemon in a test, so nothing here proves a `docker:28-cli` container rebuilds Legion.
// What is pinned is what the code decides: the image's declared version, what blocks the update,
// the ephemeral container's EXACT command line, and the lock. The docker executor is injected.
//
// The starting state to get rid of, measured 01/09 on the real install:
// `{sha: "", branch: null, blocker: "detached", checkError: "no-slug"}`.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import type { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Its own temp database, BEFORE importing shared/db. Without it the real-fleet test
// (`db.delete(runners)`) ran on the default database: empty in a session container, the REAL dev
// database on an operator machine, where only a foreign key stopped it wiping runners (02/09).
const testDbDir = mkdtempSync(join(tmpdir(), "legion-docker-mode-"));
process.env.LEGION_DB = join(testDbDir, "test.db");
process.env.LEGION_DATA = testDbDir;
after(() => rmSync(testDbDir, { recursive: true, force: true }));
import type { DockerExec, DockerResult } from "../shared/docker-exec.js";
import type { LocalGit } from "./git.js";
import type { SshRunner } from "./docker-update.js";

// Dynamic imports, after the env above: static imports are hoisted and `shared/db` would pin the
// default database path first.
const { runtimeMode, stampedGit } = await import("./stamp.js");
const { updateBlocker } = await import("./guards.js");
const {
  hostPaths,
  startDockerUpdate,
  updaterArgs,
  updaterScript,
  UPDATE_CONTAINER,
  UPDATER_IMAGE,
} = await import("./docker-update.js");
const { startUpdate, versionState } = await import("./updates.js");
const { db, schema } = await import("../shared/db.js");

// What `deploy/up.sh` stamps into a healthy image.
const STAMPED = {
  LEGION_GIT_DESCRIBE: "v0.4.0-3-gae5ab51",
  LEGION_GIT_SHA: "ae5ab51",
  LEGION_GIT_BRANCH: "main",
  LEGION_GIT_ORIGIN: "git@github-legion:ou-pas/legion.git",
  LEGION_HOST_REPO: "/home/operator/legion",
  LEGION_HOST_HOME: "/home/operator",
} satisfies NodeJS.ProcessEnv;

/** An image built by hand: `docker build` without a single `--build-arg`. */
const UNSTAMPED: NodeJS.ProcessEnv = {};

const HOST = { repo: "/home/operator/legion", home: "/home/operator" };

/** Records calls and answers what it is told to. */
function fakeExec(answers: (args: string[]) => Partial<DockerResult>) {
  const calls: string[][] = [];
  const exec: DockerExec = async (args) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "", ...answers(args) };
  };
  return { exec, calls };
}

/** No `legion-update` container, the normal state. Used by Docker-mode tests not about `updating`,
 *  so no real `docker` gets spawned by default. */
const NO_UPDATE_RUNNING = fakeExec(() => ({ code: 1, stderr: "No such object" })).exec;

// AC#1: the RUNNING version.

describe("the mode is read from a fact, not a setting", () => {
  it("a folder with .git is a clone", () => {
    // This repo IS a clone (possibly a worktree, where `.git` is a file; both count).
    assert.equal(runtimeMode(process.cwd().replace(/\/server\/?$/, "")), "bare");
  });

  it("a folder without .git is an image", () => {
    // `.dockerignore` excludes `.git` from the build context, which makes the criterion reliable.
    assert.equal(runtimeMode("/nowhere-that-exists"), "docker");
  });
});

describe("what the image says about itself", () => {
  it("the version stamped by the build ARGs", () => {
    const g = stampedGit(STAMPED);
    assert.equal(g.sha, "ae5ab51");
    assert.equal(g.branch, "main");
    assert.equal(g.lastTag, "v0.4.0");
    assert.equal(g.ahead, 3);
    assert.equal(g.tag, null); // HEAD had no tag: ahead, not "versionless"
    assert.equal(g.slug, "ou-pas/legion"); // the SSH alias is recognised by `githubSlug`
    assert.equal(g.stamped, true);
  });

  it("an image built exactly ON a tag", () => {
    const g = stampedGit({ ...STAMPED, LEGION_GIT_DESCRIBE: "v0.4.0-0-g5f49805" });
    assert.equal(g.tag, "v0.4.0");
    assert.equal(g.ahead, 0);
  });

  it("a never-tagged repo: no tag, but an origin, so something to compare", () => {
    const g = stampedGit({ ...STAMPED, LEGION_GIT_DESCRIBE: "" });
    assert.equal(g.lastTag, null);
    assert.equal(g.slug, "ou-pas/legion");
    assert.equal(g.stamped, true);
  });

  it("an image built without the ARGs claims nothing", () => {
    const g = stampedGit(UNSTAMPED);
    assert.deepEqual(
      { sha: g.sha, branch: g.branch, lastTag: g.lastTag, slug: g.slug, stamped: g.stamped },
      { sha: "", branch: null, lastTag: null, slug: null, stamped: false },
    );
  });

  it("a container has no working tree: `dirty` is false, never guessed", () => {
    assert.equal(stampedGit(STAMPED).dirty, false);
  });
});

describe("in the container, /api/version really compares", () => {
  it('never again "nothing to compare" on a healthy install', async () => {
    const s = await versionState({
      mode: "docker",
      env: STAMPED,
      tags: async (slug) => {
        assert.equal(slug, "ou-pas/legion"); // the STAMPED slug is the one queried
        return { ok: true, tags: ["v0.4.0", "v0.5.0", "latest"] };
      },
      sessions: () => 0,
      exec: NO_UPDATE_RUNNING,
    });
    assert.equal(s.mode, "docker");
    assert.equal(s.sha, "ae5ab51"); // ← was "" on the server on 01/09
    assert.equal(s.branch, "main"); // ← was null
    assert.equal(s.lastTag, "v0.4.0");
    assert.equal(s.ahead, 3);
    assert.equal(s.checkError, null); // ← was "no-slug"
    assert.equal(s.reachable, true);
    assert.equal(s.target, "v0.5.0");
    assert.equal(s.blocker, null); // ← was "detached": the button shows
    assert.equal(s.updating, false);
  });

  it("an image without a stamped version SAYS so, instead of talking about a detached HEAD", async () => {
    const s = await versionState({
      mode: "docker",
      env: UNSTAMPED,
      sessions: () => 0,
      exec: NO_UPDATE_RUNNING,
    });
    assert.equal(s.mode, "docker");
    assert.equal(s.blocker, "unstamped");
    assert.match(s.reason ?? "", /built without its version/);
    assert.match(s.reason ?? "", /up\.sh/); // the sentence carries the fix
    assert.doesNotMatch(s.reason ?? "", /HEAD is detached/);
    assert.doesNotMatch(s.reason ?? "", /not a GitHub repository/);
  });

  it("a running session still takes priority over the image's ignorance", async () => {
    // Same order in both modes: what costs work is said first.
    const s = await versionState({
      mode: "docker",
      env: UNSTAMPED,
      sessions: () => 2,
      exec: NO_UPDATE_RUNNING,
    });
    assert.equal(s.blocker, "sessions");
  });
});

// `updating`, the global signal (02/09): the bar and banner read this bit, through the same
// `docker inspect` as `startDockerUpdate`'s lock.

describe("`updating` in Docker mode rereads the launch lock", () => {
  it("the legion-update container runs: updating = true", async () => {
    const exec = fakeExec((args) =>
      args[0] === "inspect" ? { code: 0, stdout: "true\n" } : {},
    ).exec;
    // UNSTAMPED: no slug, so no real GitHub `fetch`.
    const s = await versionState({ mode: "docker", env: UNSTAMPED, sessions: () => 0, exec });
    assert.equal(s.updating, true);
  });

  it("the container exists but is stopped (carcass): updating = false", async () => {
    const exec = fakeExec((args) =>
      args[0] === "inspect" ? { code: 0, stdout: "false\n" } : {},
    ).exec;
    const s = await versionState({ mode: "docker", env: UNSTAMPED, sessions: () => 0, exec });
    assert.equal(s.updating, false);
  });

  it("no container: updating = false, without looking like a docker failure", async () => {
    const s = await versionState({
      mode: "docker",
      env: UNSTAMPED,
      sessions: () => 0,
      exec: NO_UPDATE_RUNNING,
    });
    assert.equal(s.updating, false);
  });
});

describe("the guard knows one more refusal, in its right place", () => {
  const OK = {
    activeSessions: 0,
    dirty: false,
    branch: "main",
    target: "v0.5.0",
    reachable: true,
  };

  it("an image without a version: `unstamped`, not `detached`", () => {
    assert.equal(updateBlocker({ ...OK, stamped: false, branch: null }), "unstamped");
  });

  it("undeclared `stamped` means yes: bare mode has nothing to say", () => {
    assert.equal(updateBlocker(OK), null);
  });
});

// AC#2: the ephemeral, detached container.

describe("the host paths, without which nothing is possible", () => {
  it("read from the env set by compose", () => {
    assert.deepEqual(hostPaths(STAMPED), HOST);
  });

  it("missing: no guessing, a `git fetch` in the wrong place cannot be undone", () => {
    assert.equal(hostPaths({ LEGION_HOST_REPO: "/home/operator/legion" }), null);
    assert.equal(hostPaths({}), null);
  });
});

describe("the ephemeral container's command line", () => {
  const args = updaterArgs(HOST, { target: "v0.5.0", logName: "2026-09-01T10-00-00-000Z.log" });

  it("detached, named, on the image that already has git, ssh and compose", () => {
    assert.equal(args[0], "run");
    assert.ok(args.includes("-d"), "detached: it must outlive the control plane it replaces");
    assert.deepEqual(args.slice(2, 4), ["--name", UPDATE_CONTAINER]);
    assert.ok(args.includes(UPDATER_IMAGE));
  });

  it("the host socket, because it does the rebuild", () => {
    assert.ok(args.includes("/var/run/docker.sock:/var/run/docker.sock"));
  });

  it("THE CLONE AT THE SAME ABSOLUTE PATH AS ON THE HOST", () => {
    // `compose.yaml` declares `../server/data`, resolved ON THE HOST; mounting the clone elsewhere
    // would start a control plane whose database points nowhere.
    assert.ok(args.includes(`${HOST.repo}:${HOST.repo}`));
    assert.deepEqual(args.slice(args.indexOf("-w"), args.indexOf("-w") + 2), ["-w", HOST.repo]);
  });

  it("the operator's SSH key, read-only: the repository is private", () => {
    assert.ok(args.includes(`${HOST.home}/.ssh:${HOST.home}/.ssh:ro`));
  });

  it("HOME is the HOST's, or compose would mount root's key", () => {
    assert.ok(args.includes(`HOME=${HOST.home}`));
    // Also under its own name: the image metadata sets HOME=/root and `up.sh` prefers the
    // inherited value (fourth click, 02/09).
    assert.ok(args.includes(`LEGION_HOST_HOME=${HOST.home}`));
  });

  it("the script is the last argument, after `sh -c`", () => {
    assert.deepEqual(args.slice(-3, -1), ["sh", "-c"]);
  });
});

describe("what the ephemeral container does", () => {
  const script = updaterScript({ target: "v0.5.0", logName: "2026-09-01T10-00-00-000Z.log" });

  it("it fetches, resets, rebuilds, in that order", () => {
    // `safe.directory` opens the git sequence: root container, operator-owned clone, otherwise
    // "dubious ownership" before the fetch (first real click, 01/09, exit 128 in two seconds).
    // `.ssh` is copied before any git: OpenSSH ignores $HOME, so the operator's alias remote is only
    // reachable once copied under /root (second click).
    const steps = [
      'cp -R "$HOME/.ssh/." /root/.ssh/',
      'git config --global --add safe.directory "$PWD"',
      "git fetch --tags --prune --force",
      "git reset --hard v0.5.0",
      "./deploy/up.sh",
    ];
    // Never `export HOME=`: compose interpolates `${HOME}/.ssh/…` during `up.sh`, so every ssh://
    // runner would be unreachable after a successful update (third click, 02/09).
    assert.ok(!script.includes("export HOME"), "the script must never rewrite HOME");
    let at = -1;
    for (const s of steps) {
      const next = script.indexOf(s);
      assert.ok(next > at, `"${s}" is missing or out of place`);
      at = next;
    }
  });

  it("RESET TO THE TAG, NOT CHECKOUT: the button must work TWICE", () => {
    // `git checkout <tag>` would leave the clone detached, and the next update would refuse forever.
    // The reset reaches the exact tag while staying on the branch.
    assert.doesNotMatch(script, /git checkout/);
    assert.match(script, /git reset --hard/);
    // Not `merge --ff-only` either: after the 14/09 author rewrite, "refusing to merge unrelated
    // histories" left the button useless. A deployment clone is a mirror: reset, not merged.
    assert.ok(!script.includes("merge --ff-only"), "the mirror is reset, not merged");
    // The receipt: nothing refused, but what is discarded is logged first.
    assert.match(script, /git status --porcelain/);
  });

  it("everything goes to the log, the only witness of a control plane dying midway", () => {
    assert.match(script, /server\/data\/updates\//);
    assert.match(script, /exec >>"\$LOG" 2>&1/);
  });

  it("it refuses BEFORE writing anything if the path is not a clone", () => {
    // Otherwise a wrong LEGION_HOST_REPO creates random folders on the host, and the log path shown
    // on screen leads to a file that does not exist.
    const guard = script.indexOf("[ -e .git ]");
    assert.ok(guard >= 0, "the guard is missing");
    assert.ok(guard < script.indexOf("mkdir -p"), "the guard must precede the first mkdir");
  });

  it("no host path is interpolated: `$PWD` is the clone", () => {
    assert.doesNotMatch(script, /\/home\/operator/);
    assert.match(script, /\$PWD/);
  });

  it("a tag that is not one never enters a shell", () => {
    // The belt: the list comes from the GitHub API and this container holds the host's socket.
    assert.throws(() => updaterScript({ target: "v1.0.0; rm -rf /", logName: "x.log" }), /refused/);
    assert.throws(() => updaterScript({ target: "$(id)", logName: "x.log" }), /refused/);
  });
});

// The three fleet images, rebuilt on every enabled runner (02/09 session, 03/09 browser and proxy).

describe("the script rebuilds fleet images on every ssh:// runner", () => {
  const RUNNERS: SshRunner[] = [
    { name: "mini-atelier", dockerHost: "ssh://operator@mini-atelier.local" },
    { name: "studio", dockerHost: "ssh://operator@studio.local" },
  ];

  it("AFTER `./deploy/up.sh`, so the new control plane is alive during remote builds", () => {
    const script = updaterScript({ target: "v0.5.0", logName: "x.log", runners: RUNNERS });
    const upSh = script.indexOf("./deploy/up.sh");
    const firstRunner = script.indexOf("mini-atelier.local");
    assert.ok(upSh >= 0 && firstRunner > upSh, "the fleet rebuild must follow `up.sh`");
  });

  it("one `DOCKER_HOST` per runner, passed to `make image-session`", () => {
    const script = updaterScript({ target: "v0.5.0", logName: "x.log", runners: RUNNERS });
    assert.match(script, /DOCKER_HOST="\$RUNNER_HOST" make SHELL=\/bin\/sh image-session/);
    assert.match(script, /RUNNER_HOST='ssh:\/\/operator@mini-atelier\.local'/);
    assert.match(script, /RUNNER_HOST='ssh:\/\/operator@studio\.local'/);
  });

  // The 03/09 regression: only `image-session` was replayed, so a `browser-image/` fix never
  // deployed (Playwright 1.49 service against a 1.62 repo, half an hour lost).
  it("the TWO other images go through the same step: browser and proxy, on every runner", () => {
    const script = updaterScript({ target: "v0.5.0", logName: "x.log", runners: RUNNERS });
    assert.match(script, /DOCKER_HOST="\$RUNNER_HOST" make SHELL=\/bin\/sh image-browser/);
    assert.match(script, /DOCKER_HOST="\$RUNNER_HOST" make SHELL=\/bin\/sh image-proxy/);
    // Once per runner: each machine's daemon holds its own image.
    assert.equal(
      (script.match(/make SHELL=\/bin\/sh image-browser/g) ?? []).length,
      RUNNERS.length,
    );
    assert.equal((script.match(/make SHELL=\/bin\/sh image-proxy/g) ?? []).length, RUNNERS.length);
  });

  it("each (runner, image) pair is an `if`: a failure does not trip `set -e`, the loop goes on", () => {
    const script = updaterScript({ target: "v0.5.0", logName: "x.log", runners: RUNNERS });
    // Three images × two runners. Under `set -e` a command failing OUTSIDE an `if` test would kill
    // the script on the spot.
    assert.equal((script.match(/^if DOCKER_HOST=/gm) ?? []).length, 6);
    // Seven `fi` since 13/09: the seventh is the closing line, which reads the failure counter to
    // say "✓ done" or "⛔ done". Rebuild `if`s are counted separately to keep the number meaningful.
    assert.equal((script.match(/^fi$/gm) ?? []).length, 7);
  });

  it("a failure is NAMED in the log: which machine, which image, and how to catch up", () => {
    const script = updaterScript({ target: "v0.5.0", logName: "x.log", runners: RUNNERS });
    for (const [label, target] of [
      ["session image", "image-session"],
      ["browser image", "image-browser"],
      ["proxy image", "image-proxy"],
    ] as const) {
      assert.ok(
        script.includes(`⛔ $RUNNER_NAME: ${label} — rebuild failed`),
        `the ${target} failure must be named in the log`,
      );
    }
    // The prescribed action must be doable (13/09): "a manual `make <target>`" is false on the
    // control plane machine, which only has docker. The Infra card button replays this exactly.
    assert.ok(
      script.includes("“Rebuild here” on the Infra card replays exactly this gesture"),
      "the log must prescribe something the machine can do",
    );
    assert.ok(!script.includes("” will catch up"), "and no longer the old one, which assumed pnpm");
    // Never fatal, and the message SAYS so: someone will read it at 2 a.m.
    assert.match(script, /no consequence for this update/);
  });

  it("the closing line SAYS whether a rebuild failed, instead of ticking no matter what", () => {
    // 13/09: three runners failed their session image and all three logs ended with "✓ done".
    const script = updaterScript({ target: "v0.5.0", logName: "x.log", runners: RUNNERS });
    assert.match(script, /REBUILD_KO=0/, "the counter opens before the first image");
    assert.match(script, /REBUILD_KO=\$\(\(REBUILD_KO\+1\)\)/, "and each failure increments it");
    assert.match(script, /⛔ done — \$REBUILD_KO rebuild\(s\) failed/);
    // "done" stays in both cases: `parseFleetOutcome` recognises a complete log by it.
    assert.match(script, /say "✓ done\."/);
  });

  it("a runner name cannot escape the script, even with a quote or `$(...)` in it", () => {
    // The operator picks the name at declaration, with no character allowlist, unlike the tag.
    const script = updaterScript({
      target: "v0.5.0",
      logName: "x.log",
      runners: [{ name: "the workshop's $(id)", dockerHost: "ssh://operator@atelier.local" }],
    });
    assert.match(script, /RUNNER_NAME='the workshop'\\''s \$\(id\)'/);
    // The name never appears unescaped in double quotes: only `$RUNNER_NAME`, never re-evaluated.
    assert.doesNotMatch(script, /say "[^"]*\$\(id\)/);
  });

  it("no active ssh:// runner: the log says so, no silent empty loop", () => {
    const script = updaterScript({ target: "v0.5.0", logName: "x.log" });
    assert.match(script, /no active ssh:\/\/ runner/);
    assert.doesNotMatch(script, /DOCKER_HOST=/);
  });

  it("`updaterArgs` carries the same list into the container script", () => {
    const args = updaterArgs(HOST, { target: "v0.5.0", logName: "x.log", runners: RUNNERS });
    const script = args[args.length - 1]!;
    assert.match(script, /mini-atelier\.local/);
    assert.match(script, /studio\.local/);
  });

  it("`startDockerUpdate` carries the list to `docker run`; without it, nothing to rebuild", async () => {
    const { exec, calls } = fakeExec((a) =>
      a[0] === "inspect" ? { code: 1, stderr: "No such object" } : {},
    );
    await startDockerUpdate(
      { target: "v0.5.0", logName: "x.log", runners: RUNNERS },
      { env: STAMPED, updatesDir: "/tmp/legion-test-updates", exec },
    );
    const run = calls.find((c) => c[0] === "run")!;
    const script = run[run.length - 1]!;
    assert.match(script, /mini-atelier\.local/);
    assert.match(script, /studio\.local/);
  });
});

describe("in Docker mode, `startUpdate` arms the fleet", () => {
  const version = {
    mode: "docker" as const,
    env: STAMPED,
    sessions: () => 0,
    tags: async () => ({ ok: true as const, tags: ["v0.4.0", "v0.5.0"] }),
  };

  it("the caller's injected list enters the ephemeral container's script", async () => {
    const { exec, calls } = fakeExec((a) =>
      a[0] === "inspect" ? { code: 1, stderr: "No such object" } : {},
    );
    await startUpdate({
      version,
      exec,
      env: STAMPED,
      runners: () => [{ name: "mini-atelier", dockerHost: "ssh://operator@mini-atelier.local" }],
    });
    const run = calls.find((c) => c[0] === "run")!;
    assert.match(run[run.length - 1]!, /mini-atelier\.local/);
  });

  it("without injection the real fleet (`activeSshRunners`) decides: empty here, table cleared", async () => {
    db.delete(schema.runners).run();
    const { exec, calls } = fakeExec((a) =>
      a[0] === "inspect" ? { code: 1, stderr: "No such object" } : {},
    );
    await startUpdate({ version, exec, env: STAMPED });
    const run = calls.find((c) => c[0] === "run")!;
    assert.match(run[run.length - 1]!, /no active ssh:\/\/ runner/);
  });
});

describe("the lock is the container name", () => {
  it("an update already running refuses a second one, and launches nothing", async () => {
    const { exec, calls } = fakeExec((a) =>
      a[0] === "inspect" ? { code: 0, stdout: "true\n" } : {},
    );
    await assert.rejects(
      () =>
        startDockerUpdate(
          { target: "v0.5.0", logName: "x.log" },
          { env: STAMPED, updatesDir: "/data/updates", exec },
        ),
      /already running/,
    );
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["inspect"],
    );
  });

  it("a STOPPED carcass is removed and does not block the next one", async () => {
    const { exec, calls } = fakeExec((a) =>
      a[0] === "inspect" ? { code: 0, stdout: "false\n" } : {},
    );
    const r = await startDockerUpdate(
      { target: "v0.5.0", logName: "x.log" },
      { env: STAMPED, updatesDir: "/tmp/legion-test-updates", exec },
    );
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["inspect", "rm", "run"],
    );
    // The log path is the HOST's: that is where the operator reads it.
    assert.equal(r.logPath, "/home/operator/legion/server/data/updates/x.log");
    assert.equal(r.target, "v0.5.0");
  });

  it("no container with that name: launch without `rm`", async () => {
    const { exec, calls } = fakeExec((a) =>
      a[0] === "inspect" ? { code: 1, stderr: "No such object" } : {},
    );
    await startDockerUpdate(
      { target: "v0.5.0", logName: "x.log" },
      { env: STAMPED, updatesDir: "/tmp/legion-test-updates", exec },
    );
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["inspect", "run"],
    );
  });

  it("a refused `run` is reported, not swallowed", async () => {
    const { exec } = fakeExec((a) =>
      a[0] === "run" ? { code: 125, stderr: "no such image" } : { code: 1 },
    );
    await assert.rejects(
      () =>
        startDockerUpdate(
          { target: "v0.5.0", logName: "x.log" },
          { env: STAMPED, updatesDir: "/tmp/legion-test-updates", exec },
        ),
      /no such image/,
    );
  });

  it("without the host paths, refuse BEFORE touching the daemon", async () => {
    const { exec, calls } = fakeExec(() => ({}));
    await assert.rejects(
      () =>
        startDockerUpdate(
          { target: "v0.5.0", logName: "x.log" },
          { env: UNSTAMPED, updatesDir: "/tmp/legion-test-updates", exec },
        ),
      /LEGION_HOST_REPO/,
    );
    assert.deepEqual(calls, []);
  });
});

// AC#3: bare mode does not change.

/** A healthy clone on main, one tag behind. */
const BARE_MAIN: LocalGit = {
  branch: "main",
  sha: "5f49805",
  tag: "v0.4.0",
  lastTag: "v0.4.0",
  ahead: 0,
  dirty: false,
  slug: "ou-pas/legion",
};

/** Records what `startBareUpdate` launched, launching nothing. */
function fakeSpawn() {
  const calls: { cmd: string; args: readonly string[]; opts: Record<string, unknown> }[] = [];
  const fn = ((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  }) as unknown as typeof spawn;
  return { fn, calls };
}

describe("bare mode keeps EXACTLY its behaviour", () => {
  const version = {
    mode: "bare" as const,
    local: async () => BARE_MAIN,
    tags: async () => ({ ok: true as const, tags: ["v0.4.0", "v0.5.0"] }),
    sessions: () => 0,
  };

  it("it launches the detached script, and nothing else", async () => {
    const spawner = fakeSpawn();
    const { exec, calls: dockerCalls } = fakeExec(() => ({}));
    const r = await startUpdate({ version, spawnFn: spawner.fn, exec });

    assert.equal(spawner.calls.length, 1);
    const [call] = spawner.calls;
    assert.equal(call!.cmd, process.execPath);
    // TypeScript since 09/09, run through the `tsx` loader: the first two arguments are the loader.
    assert.equal(call!.args[0], "--import");
    assert.equal(call!.args[1], "tsx");
    assert.match(String(call!.args[2]), /scripts\/self-update\.ts$/);
    assert.equal(call!.args[3], "v0.5.0");
    assert.equal(call!.opts.detached, true); // it outlives the server tsx watch will kill
    assert.deepEqual((call!.opts.stdio as unknown[])[0], "ignore");
    assert.equal((call!.opts.env as NodeJS.ProcessEnv).LEGION_UPDATE_TARGET, "v0.5.0");
    assert.equal(r.target, "v0.5.0");
    assert.match(r.logPath, /updates\/.*\.log$/);

    // NO docker call: bare mode never talked to a daemon.
    assert.deepEqual(dockerCalls, []);
  });

  it("it does not read the stamped version, even if the env carries one", async () => {
    // A developer with these variables in their shell must not see the card lie.
    const s = await versionState({ ...version, env: STAMPED });
    assert.equal(s.mode, "bare");
    assert.equal(s.sha, "5f49805"); // the clone's, not the stamped "ae5ab51"
    assert.equal(s.blocker, null);
  });

  it("the refusal is still checked before launching, in both modes", async () => {
    const spawner = fakeSpawn();
    await assert.rejects(
      () => startUpdate({ version: { ...version, sessions: () => 1 }, spawnFn: spawner.fn }),
      /session/,
    );
    assert.deepEqual(spawner.calls, []);
  });

  describe("`updating` in bare mode rereads the log, not in-memory state", () => {
    // A real folder: `bare-lock.test.ts` proves the reading logic; this checks the wiring.
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "legion-updates-"));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("an empty folder: no update ever ran here", async () => {
      const s = await versionState({ ...version, updatesDir: dir });
      assert.equal(s.updating, false);
    });

    it("a log without a closing line: the script is still writing", async () => {
      writeFileSync(
        join(dir, "2026-09-02T10-00-00-000Z.log"),
        "[2026-09-02T10:00:00Z] — fetching tags\n",
      );
      const s = await versionState({ ...version, updatesDir: dir });
      assert.equal(s.updating, true);
    });

    it("a finished log: nothing running", async () => {
      writeFileSync(
        join(dir, "2026-09-02T10-00-00-000Z.log"),
        "[2026-09-02T10:00:00Z] ✓ Update done: abc123 → v0.5.0.\n",
      );
      const s = await versionState({ ...version, updatesDir: dir });
      assert.equal(s.updating, false);
    });
  });
});
