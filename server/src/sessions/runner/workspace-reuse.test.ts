// The two consequences of a `/workspace` surviving the pause (D13, /artifacts/rtQLldYSm2/spec.md).
//
//  1. The wake-up no longer re-clones, it fetches. Not an optimisation: `git clone` into a
//     non-empty folder FAILS. Without the existence check every wake-up would die on "destination
//     path already exists".
//  2. A revocation must reach the disk. Grants are re-resolved at every wake-up, but the workspace
//     keeps what it had. A repository removed from an agent during its pause would stay readable in
//     its workspace forever: a SILENT failure, hence a test.
//
// `setupRepos` is IMPORTED from `repos.mts` (moved out of `session-runner.mts` on 06/09) and called
// against real git repositories for what its effects make observable: what it reports
// (`repo_ready`) and what it leaves on disk. Two things stay source reads, for lack of an
// observable fact:
//  · `pruneWorkspace` is PRIVATE, with no injection seam on `git`, so the exact order of one of its
//    gestures relative to the clone can only be proven by reading it;
//  · the absence of a prompt sentence ("freshly re-cloned") leaves nothing to observe.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { setupRepos } from "../../../../runner-payload/repos.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** 06/09: the five git gestures moved from `session-runner.mts` to `repos.mts`, which the source
 *  guard still reads for what is not observable otherwise (see header). */
const REPOS = resolve(ROOT, "runner-payload/repos.mts");

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();
}

/** A bare remote, with one commit on `main` and one on the run branch. */
function makeRemote(branch: string): string {
  const bare = tmp("legion-remote-");
  git(bare, "init", "--bare", "--initial-branch=main", ".");
  const seed = tmp("legion-seed-");
  git(seed, "init", "--initial-branch=main", ".");
  writeFileSync(join(seed, "README.md"), "v1\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "v1");
  git(seed, "remote", "add", "origin", bare);
  git(seed, "push", "origin", "main");
  git(seed, "checkout", "-b", branch);
  writeFileSync(join(seed, "work.txt"), "round 1\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "round 1");
  git(seed, "push", "origin", branch);
  return bare;
}

describe("wake-up on a kept workspace: the rule, against real git", () => {
  const BRANCH = "legion/xyz";

  it("re-cloning over an existing clone FAILS: what the existence check avoids", () => {
    const remote = makeRemote(BRANCH);
    const work = tmp("legion-work-");
    const dir = join(work, "repos", "legion");
    git(work, "clone", "--depth", "50", remote, dir);

    assert.throws(
      () => git(work, "clone", "--depth", "50", remote, dir),
      /already exists/i,
      "without the existence check, every wake-up would die here",
    );
  });

  it("fetch + checkout -B brings back pushed work WITHOUT touching untracked files", () => {
    const remote = makeRemote(BRANCH);
    const work = tmp("legion-work-");
    const dir = join(work, "repos", "legion");
    git(work, "clone", "--depth", "50", remote, dir);
    git(dir, "fetch", "--depth", "50", "origin", BRANCH);
    git(dir, "checkout", "-B", BRANCH, "FETCH_HEAD");

    // What the session leaves behind and is expensive to redo.
    mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "left-pad", "index.js"), "640 MB");

    // A second round pushes to the same branch, from elsewhere.
    const other = tmp("legion-other-");
    git(other, "clone", remote, ".");
    git(other, "checkout", BRANCH);
    writeFileSync(join(other, "work.txt"), "round 2\n");
    git(other, "add", "-A");
    git(other, "commit", "-m", "round 2");
    git(other, "push", "origin", BRANCH);

    // The wake-up: fetch, not clone.
    git(dir, "fetch", "--depth", "50", "origin", BRANCH);
    git(dir, "checkout", "-B", BRANCH, "FETCH_HEAD");

    assert.equal(
      readFileSync(join(dir, "work.txt"), "utf8"),
      "round 2\n",
      "the pushed work is there",
    );
    assert.equal(
      readFileSync(join(dir, "node_modules", "left-pad", "index.js"), "utf8"),
      "640 MB",
      "and node_modules survived: the WHOLE point of the lot",
    );
  });

  it("checkout -B (not -b): the branch already exists on a reused clone", () => {
    const remote = makeRemote(BRANCH);
    const work = tmp("legion-work-");
    const dir = join(work, "repos", "legion");
    git(work, "clone", "--depth", "50", remote, dir);
    git(dir, "checkout", "-B", BRANCH);

    assert.throws(() => git(dir, "checkout", "-b", BRANCH), /already exists/i);
    git(dir, "checkout", "-B", BRANCH); // idempotent
  });
});

describe("the runner source applies these rules", () => {
  const src = readFileSync(REPOS, "utf8");

  it("pruneWorkspace precedes the clone: the order is not observable from outside", () => {
    // A revoked repository must disappear BEFORE the coming run reads the workspace, otherwise it
    // stays readable for that whole run. `pruneWorkspace` has no injection seam on `git` (unlike
    // `DockerRunner.exec`), so its order relative to the clone can only be proven by reading. The
    // CALL, not the definition: the definition sits higher in the file since the 06/09 split, and
    // searching for it would make the test pass while proving nothing.
    const prune = src.indexOf("\n  await pruneWorkspace(");
    const clone = src.indexOf('await git(["clone"');
    assert.ok(prune > 0 && prune < clone, "pruneWorkspace must be called BEFORE the clone");
  });

  it('no longer promises "freshly re-cloned" anywhere', () => {
    // An absence has no behaviour: nothing `setupRepos` reports or leaves on disk would say whether
    // this sentence came back.
    assert.equal(/freshly re-cloned/.test(src), false);
  });
});

describe("setupRepos: the REAL code applies these rules", () => {
  type SetupEvent = { type: string; payload?: Record<string, unknown> };

  /** `configureGit` writes a GLOBAL `user.name`/`user.email` (`git config --global`): without
   *  isolating `HOME`, this test would pollute the `~/.gitconfig` of the machine running it.
   *  `LEGION_WORKDIR` isolates `repos/` and `.claude/skills/`, which `pruneWorkspace` looks at. */
  async function setup(
    workdir: string,
    repos: { name: string; url: string; access: "write" | "read" }[],
    skills: { name: string }[] = [],
  ): Promise<SetupEvent[]> {
    const events: SetupEvent[] = [];
    const prevHome = process.env.HOME;
    const prevWorkdir = process.env.LEGION_WORKDIR;
    process.env.HOME = workdir;
    process.env.LEGION_WORKDIR = workdir;
    try {
      await setupRepos({
        spec: {
          repos,
          repoBranch: "legion/T",
          gitAuthor: { name: "t", email: "t@t.local" },
          skills: skills.map((s) => ({ ...s, files: [] })),
          rules: [],
        },
        report: async (type: string, payload?: Record<string, unknown>) => {
          events.push({ type, payload });
        },
      });
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevWorkdir === undefined) delete process.env.LEGION_WORKDIR;
      else process.env.LEGION_WORKDIR = prevWorkdir;
    }
    return events;
  }

  it("says repo_ready with reused: false on clone, reused: true on resume", async () => {
    const remote = makeRemote("legion/T");
    const workdir = tmp("legion-setup-");

    const first = await setup(workdir, [{ name: "legion", url: remote, access: "write" }]);
    assert.equal(
      first.find((e) => e.type === "repo_ready")?.payload?.reused,
      false,
      "first call: a clone",
    );

    const second = await setup(workdir, [{ name: "legion", url: remote, access: "write" }]);
    assert.equal(
      second.find((e) => e.type === "repo_ready")?.payload?.reused,
      true,
      "same workdir, second call: the clone is reused",
    );
  });

  it("pruneWorkspace keeps only the repos AND skills THE SPEC grants", async () => {
    const workdir = tmp("legion-prune-live-");
    // A leftover of an old grant: nothing grants it in this call.
    mkdirSync(join(workdir, "repos", "old-repo"), { recursive: true });
    // A granted skill: it must survive.
    mkdirSync(join(workdir, ".claude", "skills", "grilling"), { recursive: true });
    // A removed skill: it must disappear.
    mkdirSync(join(workdir, ".claude", "skills", "removed"), { recursive: true });

    await setup(workdir, [], [{ name: "grilling" }]);

    assert.deepEqual(readdirSync(join(workdir, "repos")), [], "the ungranted repo disappeared");
    assert.deepEqual(
      readdirSync(join(workdir, ".claude", "skills")).sort(),
      ["grilling"],
      "only the granted skill survives",
    );
  });
});
