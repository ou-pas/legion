// The failure of 25/08 evening, task HSV_FFG00R.
//
// An agent worked 133 turns ($3.98), wrote three files, ran 563 tests, then did `git add` +
// `git commit` ITSELF. Nothing forbids it. `pushRepos()` then ran `git status --porcelain`, got a
// CLEAN tree (everything was committed), concluded "nothing to deliver", reported
// `repo_push { changes: 0 }` and returned WITHOUT PUSHING. The container was destroyed within the
// minute, with the only copy of the commit. The task went to `review` with an artifact describing
// in detail work of which nothing remained.
//
// A clean tree has TWO opposite causes (the agent did nothing, or committed everything) and the old
// code always picked the wrong one. The question separating them is not "is the tree dirty?" but
// "has HEAD moved since the clone?".
//
// `checkpointRepos` and `pushRepos` are IMPORTED from `repos.mts` (moved out of
// `session-runner.mts` on 06/09) and called here against real git repositories. Only
// `session-runner.mts` stays out of reach (it reads its environment and calls `process.exit` on
// load), so its wiring to `checkpointRepos`, below, is still read from source: the only guard here
// that reads text rather than calling code.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { checkpointRepos, porcelainPath, pushRepos } from "../../../../runner-payload/repos.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const RUNNER = resolve(ROOT, "runner-payload/session-runner.mts");

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.local",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.local",
    },
  }).trim();
}

/** The REPOSITORY's git identity, not the helper's (see `repo()` just below for why). Call it on
 *  any working repository where the EXERCISED CODE commits: `checkpointRepos` and
 *  `squashCheckpoints` run git with the bare environment, without the `GIT_AUTHOR_*` that `git()`
 *  exports for itself. A clone inherits nothing: it needs it like the others. */
function identify(dir: string): void {
  git(dir, "config", "user.name", "t");
  git(dir, "config", "user.email", "t@t.local");
}

/** A repository with one commit, like a fresh clone on its session branch.
 *
 *  The identity is set IN THE REPOSITORY, not only in the helper's environment (13/09). `git()`
 *  above exports `GIT_AUTHOR_*` for ITS own calls; the exercised code runs git through `repos.mts`
 *  with the bare environment. On a machine without a global `user.email` (a CI container, for
 *  one) its `git commit` answered "Author identity unknown", `checkpointRepos`'s `catch` turned it
 *  into a `run_warning`, and three tests failed claiming no commit happened: true, for a reason
 *  unrelated to what they prove.
 *
 *  The remedy copies production: `repos.mts` sets `user.name`/`user.email` right after the clone
 *  (`git config --global`). These test repositories never had that step and depended on what the
 *  machine happened to have. Here it is a LOCAL config: it follows the temporary repository and
 *  does not touch the config of whoever runs the tests. */
function repo(): { dir: string; baseSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "legion-push-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "legion/T");
  identify(dir);
  execFileSync("sh", ["-c", `echo one > '${dir}/a.txt'`]);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return { dir, baseSha: git(dir, "rev-parse", "HEAD") };
}

/** The same repository with a bare remote: `pushRepos` really pushes, so it needs something on
 *  the other end. */
function repoWithRemote(): { dir: string; baseSha: string; origin: string } {
  const origin = mkdtempSync(join(tmpdir(), "legion-push-origin-"));
  dirs.push(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  const { dir, baseSha } = repo();
  git(dir, "remote", "add", "origin", origin);
  return { dir, baseSha, origin };
}

type PushEvent = { type: string; payload?: Record<string, unknown> };
type PushRepo = { name: string; dir: string; access: "write"; baseSha: string | null };

/** Calls the REAL `pushRepos` with an isolated `LEGION_WORKDIR`: `warnStrayRepos` looks at
 *  `<workdir>/repos`, and a non-isolated folder would read this test session's working tree.
 *  Returns the reported events, in order. */
async function push(
  repos: PushRepo[],
  over: {
    agentName?: string;
    fallbackCommitSubject?: string;
    readArtifact?: (p: string) => Promise<string | null>;
  } = {},
): Promise<PushEvent[]> {
  const events: PushEvent[] = [];
  const workdir = mkdtempSync(join(tmpdir(), "legion-push-workdir-"));
  dirs.push(workdir);
  const prev = process.env.LEGION_WORKDIR;
  process.env.LEGION_WORKDIR = workdir;
  try {
    await pushRepos(
      {
        spec: {
          sessionId: "s1",
          repoBranch: "legion/T",
          agentName: over.agentName ?? "dev",
          fallbackCommitSubject: over.fallbackCommitSubject ?? "chore: nothing",
        },
        report: async (type: string, payload?: Record<string, unknown>) => {
          events.push({ type, payload });
        },
        readArtifact: over.readArtifact ?? (async () => null),
      },
      repos,
    );
  } finally {
    if (prev === undefined) delete process.env.LEGION_WORKDIR;
    else process.env.LEGION_WORKDIR = prev;
  }
  return events;
}

// The truncated path (11/09): `checkpointRepos` and `pushRepos` named an uncommitted file by
// cutting the first three characters of its `git status --porcelain` line (`XY<space>path`).
// Seen in production: the safety net named `unner-payload/session-runner.mts`, missing its `r`.
// `porcelainPath` isolates that extraction so it can be tested without a git repository, on the
// exact shape that failed and on those that do not.
describe("porcelainPath: a `git status --porcelain` line, without its status", () => {
  it("a modified file, two-letter status and one space", () => {
    assert.equal(
      porcelainPath(" M runner-payload/session-runner.mts"),
      "runner-payload/session-runner.mts",
    );
  });

  it("an untracked file (`??`)", () => {
    assert.equal(porcelainPath("?? x.txt"), "x.txt");
  });

  it("a file both staged and modified (`MM`)", () => {
    assert.equal(porcelainPath("MM server/src/index.ts"), "server/src/index.ts");
  });

  it("a separator wider than one space no longer eats the path's first character", () => {
    // The exact failure: a fixed count of three characters assumes the status AND the separator
    // always fit in three characters. Nothing guarantees it; that is what returned
    // `unner-payload/...` instead of `runner-payload/...`.
    assert.equal(porcelainPath("M    server/src/index.ts"), "server/src/index.ts");
  });
});

describe("pushRepos: the rule, HEAD decides, not whether the tree is clean", () => {
  it("an agent committing itself leaves a CLEAN tree: the only signal left is HEAD", () => {
    const { dir, baseSha } = repo();

    execFileSync("sh", ["-c", `echo two > '${dir}/b.txt'`]);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "the agent commits its own work");

    // The trap, reproduced as is: the old code stopped HERE, concluding "nothing to deliver".
    assert.equal(
      git(dir, "status", "--porcelain"),
      "",
      "the tree is clean after the agent's commit",
    );
    // And this is what it did not look at.
    assert.notEqual(
      git(dir, "rev-parse", "HEAD"),
      baseSha,
      "yet HEAD moved: there is work to push",
    );
    assert.equal(
      git(dir, "diff", "--name-only", baseSha, "HEAD"),
      "b.txt",
      "the file count is taken from the starting point",
    );
  });

  it("a session that produced nothing leaves HEAD at the starting point: no empty branch is pushed", () => {
    const { dir, baseSha } = repo();
    assert.equal(git(dir, "status", "--porcelain"), "", "clean tree");
    assert.equal(
      git(dir, "rev-parse", "HEAD"),
      baseSha,
      "HEAD did not move: nothing to deliver, and this time it is true",
    );
  });

  it("a dirty tree is committed THEN judged on HEAD: both paths end at the same place", () => {
    const { dir, baseSha } = repo();
    execFileSync("sh", ["-c", `echo three > '${dir}/c.txt'`]);
    assert.notEqual(git(dir, "status", "--porcelain"), "", "dirty tree: the runner commits");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "legion: …");
    assert.notEqual(git(dir, "rev-parse", "HEAD"), baseSha);
  });
});

describe("pushRepos: the REAL code applies this rule", () => {
  it('the agent already committed everything itself: the push happens, no false "nothing to deliver"', async () => {
    const { dir, baseSha, origin } = repoWithRemote();
    execFileSync("sh", ["-c", `echo two > '${dir}/b.txt'`]);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "the agent commits its own work");
    assert.equal(git(dir, "status", "--porcelain"), "", "clean tree, as in the 25/08 failure");

    const events = await push([{ name: "repo", dir, access: "write", baseSha }]);

    const pushed = events.find((e) => e.type === "repo_push");
    assert.ok(pushed, "a repo_push must be reported");
    assert.notEqual(pushed?.payload?.changes, 0, "the agent's work must count as delivered");
    assert.equal(
      git(origin, "rev-parse", "legion/T"),
      git(dir, "rev-parse", "HEAD"),
      "the agent's commit is on the remote; the old code stopped here",
    );
  });

  it("nothing moved since the clone: repo_push says changes: 0, and nothing is pushed", async () => {
    const { dir, baseSha, origin } = repoWithRemote();

    const events = await push([{ name: "repo", dir, access: "write", baseSha }]);

    assert.deepEqual(events.find((e) => e.type === "repo_push")?.payload, {
      repo: "repo",
      branch: "legion/T",
      changes: 0,
    });
    assert.throws(
      () => git(origin, "rev-parse", "legion/T"),
      "the remote must have received no branch",
    );
  });

  it("an unknown starting point still pushes, and says so", async () => {
    const { dir, origin } = repoWithRemote();

    const events = await push([{ name: "repo", dir, access: "write", baseSha: null }]);

    assert.ok(
      events.some(
        (e) =>
          e.type === "run_warning" && /unknown starting point/.test(String(e.payload?.message)),
      ),
      "the uncertainty must be said: an extra branch can be deleted, a destroyed commit cannot",
    );
    assert.equal(
      git(origin, "rev-parse", "legion/T"),
      git(dir, "rev-parse", "HEAD"),
      "and the push still happens",
    );
  });

  it("a tree left uncommitted at push time is picked up by a safety net that REPORTS it", async () => {
    // Seen on 02/09 then 10/09: a silent catch-up left "the agent does not commit" as an impression,
    // with no date or count possible. Both the subject and the message must be checkable, not only
    // that the catch-up happened.
    const { dir, baseSha, origin } = repoWithRemote();
    execFileSync("sh", ["-c", `echo a > '${dir}/x.txt'; echo b > '${dir}/y.txt'`]);

    const events = await push([{ name: "repo", dir, access: "write", baseSha }]);

    assert.equal(
      events.find((e) => e.type === "run_warning")?.payload?.message,
      "2 file(s) left uncommitted in repo — picked up by the end-of-session safety net: x.txt, y.txt",
    );
    assert.equal(
      git(dir, "log", "-1", "--format=%s"),
      "chore: end of session — uncommitted work",
      "the subject announces a catch-up, never the agent's work",
    );
    assert.equal(
      git(origin, "rev-parse", "legion/T"),
      git(dir, "rev-parse", "HEAD"),
      "and the catch-up reaches the remote",
    );
  });
});

// Checkpoints (v29).
// The push fix (above) repairs one case; checkpoints remove the whole class. Two sessions lost on
// 25/08 share the same root: the work existed in ONE place, a disposable container, until the last
// second. Turn ceiling, OOM, Docker going down, a cut: any abrupt end took everything. Pushing
// DURING the session makes "did we reach the end cleanly?" inconsequential.
describe("checkpoints: the work no longer lives in one place", () => {
  /** The orchestration: when a checkpoint is due, and in which order relative to the inbox
   *  question. `session-runner.mts` cannot be imported (see header): the only thing in this
   *  describe still read from source. */
  const runner = readFileSync(RUNNER, "utf8");

  it("the runner calls checkpointRepos at every turn end where a checkpoint is due", () => {
    // The cadence (CHECKPOINT_EVERY_TURNS) is proven by `turn-tracker.test.ts`, which imports the
    // real constant. What remains here is the WIRING between the two modules, which turn-tracker
    // does not see.
    assert.match(
      runner,
      /ended\.checkpoint[\s\S]{0,120}checkpointRepos\(/,
      "called at every turn end where a checkpoint is due",
    );
  });

  it("a failing checkpoint does not kill the session", async () => {
    // The git index can be locked because the agent runs git at the same moment. Killing a working
    // session over that would trade a rare loss for a frequent one.
    const events: PushEvent[] = [];
    const io = {
      spec: { sessionId: "s1", repoBranch: "legion/T" },
      report: async (type: string, payload?: Record<string, unknown>) => {
        events.push({ type, payload });
      },
    };
    // A folder that is not a git repository fails `git status` exactly like a locked index would;
    // `checkpointRepos` does not tell causes apart, only the failure counts.
    const dir = mkdtempSync(join(tmpdir(), "legion-not-a-repo-"));
    dirs.push(dir);
    const r = { name: "repo", dir, access: "write" as const, baseSha: null };

    const pushed = await checkpointRepos(io, [r], 15);

    assert.equal(pushed, 0, "no push could happen");
    assert.match(
      String(events.find((e) => e.type === "run_warning")?.payload?.message),
      /checkpoint repo at turn 15/,
      "the failure is a warning, never a thrown exception, otherwise this test would have rejected",
    );
  });

  // 10/09, task `ks1wcjyVMZ`: the turn-105 checkpoint committed one second BEFORE the agent's
  // `git commit`, which got "nothing to commit, working tree clean". Its fifteen files reached
  // GitHub under a generic subject although it had written the right one in its report. A safety
  // net catches what falls, it does not snatch what is being held: the first dirty checkpoint
  // WARNS, the next one commits.
  it("first dirty checkpoint: it warns and does not commit; the next one commits", async () => {
    const { dir, baseSha } = repo();
    execFileSync("sh", ["-c", `echo draft > '${dir}/d.txt'`]);
    const nudged: { repo: string; files: string[] }[] = [];
    const io = {
      spec: { sessionId: "s1", repoBranch: "legion/T" },
      report: async () => {},
      nudge: async (name: string, files: string[]) => {
        nudged.push({ repo: name, files });
      },
    };
    const r = { name: "legion", dir, access: "write" as const, baseSha };

    await checkpointRepos(io, [r], 15);
    assert.equal(nudged.length, 1, "the agent is warned");
    assert.deepEqual(nudged[0]!.files, ["d.txt"], "and told the file names");
    assert.equal(git(dir, "rev-parse", "HEAD"), baseSha, "nothing was committed in its place");

    await checkpointRepos(io, [r], 30);
    assert.equal(nudged.length, 1, "no second warning for the same tree");
    assert.notEqual(git(dir, "rev-parse", "HEAD"), baseSha, "the safety net took over");
    // Same remedy as `pushRepos` (seen 02/09, slice nav/18): nobody usually reads this message, but a
    // conventional type rather than `legion:` keeps a history that retains checkpoints (merge, never
    // squash) from carrying one that exists in no convention. The real subject below is the proof.
    assert.match(git(dir, "log", "-1", "--format=%s"), /^chore: checkpoint \(turn 30\)/);
  });

  it("the agent commits in between: the safety net commits nothing, and rearms its warning", async () => {
    const { dir, baseSha } = repo();
    execFileSync("sh", ["-c", `echo draft > '${dir}/e.txt'`]);
    const nudged: string[] = [];
    const io = {
      spec: { sessionId: "s1", repoBranch: "legion/T" },
      report: async () => {},
      nudge: async (name: string) => {
        nudged.push(name);
      },
    };
    const r = { name: "legion", dir, access: "write" as const, baseSha };

    await checkpointRepos(io, [r], 15);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "feat: the agent names its work");
    await checkpointRepos(io, [r], 30);
    assert.equal(
      git(dir, "log", "-1", "--format=%s"),
      "feat: the agent names its work",
      "no safety-net commit on top of its own",
    );

    // A new draft later: the warning fires again, it is not consumed for life.
    execFileSync("sh", ["-c", `echo again > '${dir}/f.txt'`]);
    await checkpointRepos(io, [r], 45);
    assert.equal(nudged.length, 2);
  });

  it("the pause safety net pushes BEFORE asking its question", () => {
    const loop = runner.slice(runner.indexOf("async function onTurnEnd("));
    const checkpointAt = loop.indexOf("checkpointRepos(", loop.indexOf('kind === "pause"'));
    const askAt = loop.indexOf("askTurnBudget(guardIO, ended.turn)");
    assert.ok(checkpointAt > 0 && askAt > 0, "both landmarks must exist");
    assert.ok(checkpointAt < askAt, "the code is put in safety, THEN the human is asked");
  });
});

// The prompt moved (06/09).
// Two sets of guards lived here ("the agent commits itself, atomically", 02/09, and "the turn
// budget is stated up front", 25/08). They read the prompt text INSIDE the runner source. Now
// `buildTaskPrompt` is a pure function of `runner-payload/prompt.mts`, and both became behaviour
// tests in `runner-modules.test.ts`.

// The forced push, and the lease git refused (09/09).
//
// Four sessions on 08 and 09/09 finished their work and lost their PR on the same line:
// `! [rejected] <branch> (stale info)`. The final push is FORCED once a checkpoint rewrote history,
// and `--force-with-lease` WITHOUT A VALUE requires a remote-tracking ref updated by `fetch`. The
// runner's clone is `--depth 50`, hence single-branch: its refspec only covers the default branch.
// Git has no trustworthy lease, and refuses.
//
// Both forms are replayed against REAL repositories, because git's behaviour is what is at stake:
// the valueless form must fail on a single-branch clone, the explicit one must pass. Without the
// first half we would not know whether the fix fixes anything.
describe("forced push on a single-branch clone", () => {
  /** A bare remote, a shallow clone of it, and the session branch pushed once: the exact state of
   *  a session right after its first checkpoint. */
  function shallowClone(): { clone: string; branch: string } {
    const branch = "legion/T";
    const origin = mkdtempSync(join(tmpdir(), "legion-origin-"));
    dirs.push(origin);
    git(origin, "init", "-q", "--bare", "-b", "main");

    const seed = mkdtempSync(join(tmpdir(), "legion-seed-"));
    dirs.push(seed);
    git(seed, "init", "-q", "-b", "main");
    execFileSync("sh", ["-c", `echo one > '${seed}/a.txt'`]);
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "base");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");

    const clone = mkdtempSync(join(tmpdir(), "legion-clone-"));
    rmSync(clone, { recursive: true, force: true });
    dirs.push(clone);
    git(process.cwd(), "clone", "-q", "--depth", "50", origin, clone);
    identify(clone);
    git(clone, "checkout", "-q", "-B", branch);
    execFileSync("sh", ["-c", `echo two > '${clone}/b.txt'`]);
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", "checkpoint");
    git(clone, "push", "-q", "-u", "origin", branch);

    // The rewrite: the checkpoint is squashed, so the local sha no longer descends from the remote.
    git(clone, "reset", "-q", "--soft", "HEAD~1");
    git(clone, "commit", "-q", "-m", "squashed work");
    return { clone, branch };
  }

  it("valueless `--force-with-lease` fails: that is the failure", () => {
    const { clone, branch } = shallowClone();
    assert.throws(
      () => git(clone, "push", "--force-with-lease", "-u", "origin", branch),
      /stale info/,
      "if git accepts this lease, the fix below no longer has a reason to exist",
    );
  });

  it("`--force-with-lease=<branch>:<sha>` passes, with the sha the remote carries", () => {
    const { clone, branch } = shallowClone();
    const [sha = ""] = git(clone, "ls-remote", "--heads", "origin", branch).split(/\s+/);
    assert.match(sha, /^[0-9a-f]{40}$/, "the remote sha must be readable");
    git(clone, "push", `--force-with-lease=${branch}:${sha}`, "-u", "origin", branch);
    assert.equal(
      git(clone, "ls-remote", "--heads", "origin", branch).split(/\s+/)[0],
      git(clone, "rev-parse", "HEAD"),
      "the remote now carries the squashed commit",
    );
  });

  it("a stale lease fails: safety is intact", () => {
    const { clone, branch } = shallowClone();
    const stale = git(clone, "rev-parse", "HEAD~1");
    assert.throws(
      () => git(clone, "push", `--force-with-lease=${branch}:${stale}`, "-u", "origin", branch),
      /stale info|rejected/,
      "a fix pushed meanwhile must fail the push, not be overwritten",
    );
  });

  it("the runner gives the lease explicitly, never the bare form, proven by a REAL squash-and-push", async () => {
    // Same trap as `shallowClone()` above, but set by the REAL PATH: a checkpoint committed and
    // pushed once (what `checkpointRepos` does during the session), then `pushRepos` squashing it
    // (`squashCheckpoints`) and pushing again. The local rewrite orphans the remote tip with nothing
    // touching the remote meanwhile: exactly where valueless `--force-with-lease` fails with "stale
    // info" on a single-branch clone, as proven just above.
    const branch = "legion/T";
    const origin = mkdtempSync(join(tmpdir(), "legion-force-origin-"));
    dirs.push(origin);
    git(origin, "init", "-q", "--bare", "-b", "main");

    const seed = mkdtempSync(join(tmpdir(), "legion-force-seed-"));
    dirs.push(seed);
    git(seed, "init", "-q", "-b", "main");
    execFileSync("sh", ["-c", `echo one > '${seed}/a.txt'`]);
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "base");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "-q", "origin", "main");

    const dir = mkdtempSync(join(tmpdir(), "legion-force-clone-"));
    rmSync(dir, { recursive: true, force: true });
    dirs.push(dir);
    git(process.cwd(), "clone", "-q", "--depth", "50", origin, dir);
    identify(dir);
    git(dir, "checkout", "-q", "-B", branch);
    const baseSha = git(dir, "rev-parse", "HEAD");

    // The real checkpoint, as `checkpointRepos` would have committed and pushed it.
    execFileSync("sh", ["-c", `echo two > '${dir}/b.txt'`]);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "chore: checkpoint (turn 15) — session s1");
    git(dir, "push", "-q", "-u", "origin", branch);

    const events = await push([{ name: "repo", dir, access: "write", baseSha }]);

    const failed = events.find((e) => e.type === "repo_push_failed" || e.type === "run_error");
    assert.equal(failed, undefined, `the forced push must not fail: ${JSON.stringify(failed)}`);
    assert.equal(
      git(origin, "rev-parse", branch),
      git(dir, "rev-parse", "HEAD"),
      "the remote carries the squashed version, despite the single-branch clone trap",
    );
    assert.equal(
      git(dir, "log", "-1", "--format=%s"),
      "chore: nothing",
      "the fallback title won for lack of a pr.md: squashCheckpoints did run",
    );
  });
});

describe("pushRepos: a repository cloned by the agent is SAID, not ignored", () => {
  // The 09/09 failure (task ZsbmD_N-zS): an inbox "yes" nothing honours, a `git clone` into
  // `repos/`, two commits, and a push loop that only knows the spec: a clean `review` with zero
  // changes, commits in a volume the next wake-up erases.
  function workspace(names: string[]): string {
    const root = mkdtempSync(join(tmpdir(), "legion-stray-"));
    dirs.push(root);
    for (const n of names) mkdirSync(join(root, "repos", n), { recursive: true });
    return root;
  }
  /** Repositories granted READ-only: the loop skips them without running git, only the sweep speaks. */
  async function warnings(root: string, granted: string[]): Promise<string[]> {
    const out: string[] = [];
    const prev = process.env.LEGION_WORKDIR;
    process.env.LEGION_WORKDIR = root;
    try {
      await pushRepos(
        {
          // The stray-repository sweep reads NOTHING from the spec: the four fields are there because
          // the gesture's type names them, not because this test exercises them.
          spec: {
            sessionId: "s1",
            agentName: "dev",
            repoBranch: "legion/T",
            fallbackCommitSubject: "chore: nothing",
          },
          report: async (type: string, p?: Record<string, unknown>) => {
            if (type === "run_warning") out.push(String(p?.message ?? ""));
          },
        },
        granted.map((name) => ({
          name,
          access: "read" as const,
          url: `https://example.invalid/${name}.git`,
          dir: join(root, "repos", name),
          baseSha: null,
        })),
      );
    } finally {
      if (prev === undefined) delete process.env.LEGION_WORKDIR;
      else process.env.LEGION_WORKDIR = prev;
    }
    return out;
  }

  it("a repos/ folder outside the grant produces a run_warning naming it", async () => {
    const w = await warnings(workspace(["acme", "acme-argo-apps"]), ["acme"]);
    assert.equal(w.length, 1);
    assert.match(w.join("\n"), /repos\/acme-argo-apps/);
    assert.match(w.join("\n"), /not pushed/);
  });

  it("only granted repositories: silence", async () => {
    assert.deepEqual(await warnings(workspace(["acme"]), ["acme"]), []);
  });

  it("a stray file in repos/ is not a repository", async () => {
    const root = workspace(["acme"]);
    writeFileSync(join(root, "repos", "notes.txt"), "x");
    assert.deepEqual(await warnings(root, ["acme"]), []);
  });
});

// The agent's `reset --soft` over an already pushed checkpoint (14/09, task `P2BYzKpcD1`).
//
// `checkpointRepos` commits AND PUSHES leftovers every fifteen turns. The agent finds its work
// under "chore: checkpoint (turn N)" and makes the natural gesture to reclaim it: `git reset
// --soft`, then its own commit with its own message. It just rewrote a commit that is ALREADY on
// the remote, and nothing told it.
//
// The next push is rejected, and the catch-up rebase is the worst choice: it replays on top of the
// checkpoint patches it already contains, hits empty patches and stops. Measured in production:
// sixty turns left in a destroyed container.
describe("a remote carrying only our checkpoints is overwritten, not rebased", () => {
  it("the rewritten work still goes out, and the checkpoint disappears", async () => {
    const { dir, baseSha, origin } = repoWithRemote();

    // The checkpoint: committed and pushed, exactly as `checkpointRepos` does.
    execFileSync("sh", ["-c", `echo two > '${dir}/a.txt'`]);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "chore: checkpoint (turn 15) — session s1");
    git(dir, "push", "-q", "-u", "origin", "legion/T");
    const pushed = git(dir, "rev-parse", "HEAD");

    // The agent's gesture: go back before the checkpoint, then commit its own way.
    git(dir, "reset", "--soft", baseSha);
    git(dir, "commit", "-q", "-m", "feat: the agent's real message");

    const events = await push([{ name: "legion", dir, access: "write", baseSha }]);

    const remoteHead = git(origin, "rev-parse", "legion/T");
    assert.equal(remoteHead, git(dir, "rev-parse", "HEAD"), "the remote carries the agent's work");
    assert.notEqual(remoteHead, pushed, "the checkpoint was replaced");
    assert.equal(
      git(origin, "log", "-1", "--format=%s", "legion/T"),
      "feat: the agent's real message",
    );
    assert.ok(
      !events.some((e) => e.type === "repo_push_failed"),
      `no push failure expected: ${JSON.stringify(events.map((e) => e.type))}`,
    );
  });

  // The guard that matters: forcing applies ONLY to our own checkpoints. A real commit by someone
  // else on the branch must still go through the rebase, and fail plainly rather than be silently
  // overwritten.
  it("a commit that is not a checkpoint is never overwritten", async () => {
    const { dir, baseSha, origin } = repoWithRemote();
    git(dir, "push", "-q", "-u", "origin", "legion/T");

    // Someone else pushes to the branch, on the same file: the rebase cannot get out of it.
    const other = mkdtempSync(join(tmpdir(), "legion-push-other-"));
    dirs.push(other);
    git(other, "clone", "-q", origin, ".");
    identify(other);
    git(other, "checkout", "-q", "legion/T");
    execFileSync("sh", ["-c", `echo third > '${other}/a.txt'`]);
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "feat: someone else's work");
    git(other, "push", "-q", "origin", "legion/T");
    const theirs = git(other, "rev-parse", "HEAD");

    execFileSync("sh", ["-c", `echo ours > '${dir}/a.txt'`]);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "feat: our work");

    await push([{ name: "legion", dir, access: "write", baseSha }]);
    assert.notEqual(
      git(origin, "log", "--format=%s", "legion/T"),
      "feat: our work",
      "the other party's commit must not have been overwritten",
    );
    assert.ok(
      git(origin, "log", "--format=%s", "legion/T").includes("someone else's work"),
      `the other party's commit must survive (${theirs.slice(0, 7)})`,
    );
  });
});
