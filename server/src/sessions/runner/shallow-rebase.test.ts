// A truncated clone cannot rebase, and the gate no longer prescribes a rebase at all.
//
// What changed since (10/09 afternoon): `make fresh` now says `git merge origin/main`. GitHub's
// squash merge does the same damage on a FULL clone: a squashed PR's commits are no longer
// ancestors of `main`, so a reused branch compares against a stale base and the rebase copies
// everything (PR #158: 113 files of diff for a batch touching 22). The header of
// `scripts/fresh-check.ts` carries both measurements. This file keeps its purpose: clone depth is
// a trap in itself, and `make fresh`'s count is wrong on a truncated repository.
//
// The original defect, measured on 10/09 morning on lot 4's branch (PR #148). `make fresh`
// refused a branch behind `origin/main` and gave the command `git pull --rebase origin main`. The
// runner's clone was `--depth 50`. `git rebase` needs the merge base between the branch and `main`
// to know which commits are ALREADY upstream; below the shallow graft that base is invisible, so
// git replays everything it sees, `main`'s commits INCLUDED. They come back with new shas and hit
// add/add conflicts on identical files.
//
// Cost: thirteen commits for seven patch-ids on lot 4's branch (#146 and #147 three times each,
// one set per session resume), and three merge conflicts, one on a file the branch never meant to
// touch.
//
// Exercised against real git, like workspace-reuse.test.ts: the first case reproduces the defect,
// the second proves full history closes it, the third reads the runner source to require it no
// longer truncates.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
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

const BRANCH = "legion/lot";

/** A remote that looks like `main` during a work stream: the run branch starts from an old
 *  commit, and `main` moves several commits ahead while the session works. That gap (60 commits
 *  in two days on this repository, 08 and 09/09) pushes the merge base below a truncated clone's
 *  limit.
 *
 *  Returns the remote and the shas of `main`'s commits after the fork: a healthy rebase leaves
 *  them INTACT and a truncated rebase replays them. */
function makeRemote(mainCommitsAfterFork: number): { bare: string; after: string[] } {
  const bare = tmp("shallow-remote-");
  git(bare, "init", "--bare", "--initial-branch=main", ".");
  const seed = tmp("shallow-seed-");
  git(seed, "init", "--initial-branch=main", ".");
  writeFileSync(join(seed, "base.txt"), "v0\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "v0");
  git(seed, "remote", "add", "origin", bare);
  git(seed, "push", "-q", "origin", "main");
  const fork = git(seed, "rev-parse", "HEAD");

  // The run branch starts there, with its work, and catches up a FIRST time, correctly, from a
  // full clone. It now has `main` commits in its own ancestry, and THAT is what makes truncation
  // dangerous afterwards.
  git(seed, "checkout", "-q", "-b", BRANCH, fork);
  writeFileSync(join(seed, "lot.txt"), "the batch work\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "batch work");

  const after: string[] = [];
  const advance = (from: number, to: number) => {
    git(seed, "checkout", "-q", "main");
    for (let i = from; i <= to; i++) {
      writeFileSync(join(seed, `main-${i}.txt`), `main ${i}\n`);
      git(seed, "add", "-A");
      git(seed, "commit", "-m", `main ${i}`);
      after.push(git(seed, "rev-parse", "HEAD"));
    }
    git(seed, "push", "-q", "origin", "main");
  };

  // First round: `main` moves, the branch catches up, all healthy.
  advance(1, 3);
  git(seed, "checkout", "-q", BRANCH);
  git(seed, "rebase", "-q", "main");
  git(seed, "push", "-q", "origin", BRANCH);

  // Second round: `main` moves again. This reopens the gap the session must catch up, this time
  // with shared history below the graft limit.
  advance(4, mainCommitsAfterFork);
  return { bare, after };
}

/** The runner's wake-up: join the run branch, then apply the command `make fresh` prescribed.
 *  Returns the branch log after catching up. */
function catchUpOnMain(
  bare: string,
  clone: (dir: string, url: string) => void,
  fetchBranch: (dir: string) => void,
): string[] {
  const work = tmp("shallow-work-");
  const dir = join(work, "repos", "legion");
  clone(dir, bare);
  fetchBranch(dir);
  git(dir, "checkout", "-q", "-B", BRANCH, "FETCH_HEAD");
  git(dir, "-c", "rebase.autoStash=true", "pull", "-q", "--rebase", "origin", "main");
  return git(dir, "log", "--format=%H %s").split("\n");
}

describe("a truncated clone cannot rebase onto main", () => {
  it("THE DEFECT: truncated, the rebase replays main's commits with new shas", () => {
    // Six commits ahead on `main`, a clone that sees only two: the merge base is below the limit.
    // The situation of a session that slept overnight.
    const { bare, after } = makeRemote(6);
    let log: string[] = [];
    let threw: string | null = null;
    try {
      log = catchUpOnMain(
        bare,
        (dir, url) => {
          git(dirname(dirname(dir)), "clone", "-q", "--depth", "2", url, dir);
        },
        // The culprit: `--depth` on the branch fetch RESETS the graft limit two commits from its tip,
        // in the middle of the history the branch shares with `main` since its first catch-up. Exactly
        // what `repos.mjs` did.
        (dir) => git(dir, "fetch", "-q", "--depth", "2", "origin", BRANCH),
      );
    } catch (err) {
      // The replay can also FAIL on an add/add conflict on an identical file: the same defect seen
      // from the other side, which is what happened to lot 4.
      threw = String(err);
    }
    if (threw !== null) {
      assert.match(threw, /conflict|rebase/i, "the failure must come from the rebase");
      return;
    }
    const rejoues = after.filter((sha) => !log.some((l) => l.startsWith(sha)));
    assert.ok(
      rejoues.length > 0,
      "on a truncated clone, main's commits must come back with another sha; " +
        "if this test observes nothing anymore, git changed and the guard below can relax",
    );
  });

  it("THE FIX: full history, main's commits keep their shas", () => {
    const { bare, after } = makeRemote(6);
    const log = catchUpOnMain(
      bare,
      (dir, url) => {
        git(dirname(dirname(dir)), "clone", "-q", url, dir);
      },
      (dir) => git(dir, "fetch", "-q", "origin", BRANCH),
    );
    for (const sha of after)
      assert.ok(
        log.some((l) => l.startsWith(sha)),
        `main's commit ${sha.slice(0, 7)} must stay itself, not be replayed`,
      );
    // One commit of the batch's own, at the top: the shape a PR must have.
    assert.equal(log[0]?.endsWith("batch work"), true);
    assert.equal(
      log.filter((l) => l.endsWith("batch work")).length,
      1,
      "the batch work must not be duplicated",
    );
  });

  // Why this guard reads the source (justified in lot 11). The guarded fact is an ABSENCE ("no
  // `--depth` remains"), which calling the function cannot prove: it would need history deep
  // enough for truncation to show, a scenario depending on repository size. `setupRepos` cannot run
  // here either: it writes `git config --global` and `~/.git-credentials`, which a test must not do
  // to the machine running it. The two scenarios above replay the rebase for real.
  it("the runner no longer clones truncated, and repairs a workspace that still is", () => {
    const src = readFileSync(REPOS, "utf8");
    assert.equal(
      /clone",\s*"--depth"/.test(src) || /"--depth",\s*"50"/.test(src),
      false,
      "no `--depth` may remain: it breaks the rebase make fresh prescribes",
    );
    assert.match(
      src,
      /--is-shallow-repository/,
      "a workspace kept from before the fix is still truncated: it must be repaired",
    );
    assert.match(src, /--unshallow/, "and the repair is a `fetch --unshallow`");
  });
});
