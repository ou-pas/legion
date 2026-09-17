// The silent trace of 07/09, task NrEQhvaC2W, session 7fb0abeda02a.
//
// Two checkpoint `run_warning`s read:
//   "checkpoint legion at turn 45: Command failed: git push -u origin chore/… \n
//     To https://github.com/ou-pas/legion.git \n ! [rejected]        chore/…"
// and stopped THERE. The message was cut at 200 characters, and git writes its reason at the END
// (`(fetch first)`, `(non-fast-forward)`, `(stale info)`, then `error:` and the `hint:`s). We kept
// the noise and dropped the only line saying what to do.
//
// Two guards, as in push-repos.test.ts:
//   1. The SUMMARY is a pure function, exercised on three real git stderrs.
//   2. The GESTURE (checkpoint, final push) is replayed against real repositories: a bare remote,
//      two clones, one pushes, the other is rejected, and we read what the runner reports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { gitFailureSummary, pushRejectedBehind } from "../../../../runner-payload/git-failure.mjs";
import { checkpointRepos, pushRepos } from "../../../../runner-payload/repos.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const REPOS = resolve(ROOT, "runner-payload/repos.mts");

// Three real git stderrs, as `execFile` appends them after "Command failed: …".

const REJECTED_FETCH_FIRST = [
  "Command failed: git push -u origin chore/add-some-space-between-btn-and-list-ac73748e",
  "To https://github.com/ou-pas/legion.git",
  " ! [rejected]        chore/add-some-space-between-btn-and-list-ac73748e -> chore/add-some-space-between-btn-and-list-ac73748e (fetch first)",
  "error: failed to push some refs to 'https://github.com/ou-pas/legion.git'",
  "hint: Updates were rejected because the remote contains work that you do not",
  "hint: have locally. This is usually caused by another repository pushing to",
  "hint: the same ref. If you want to integrate the remote changes, use",
  "hint: 'git pull' before pushing again.",
  "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
].join("\n");

const REJECTED_STALE = [
  "Command failed: git push -u --force-with-lease origin legion/T",
  "To https://github.com/ou-pas/legion.git",
  " ! [rejected]        legion/T -> legion/T (stale info)",
  "error: failed to push some refs to 'https://github.com/ou-pas/legion.git'",
].join("\n");

const AUTH_DENIED = [
  "Command failed: git push -u origin legion/T",
  "remote: Permission to ou-pas/legion.git denied to legion-bot.",
  "fatal: unable to access 'https://github.com/ou-pas/legion.git/': The requested URL returned error: 403",
].join("\n");

describe("gitFailureSummary: git's reason survives, the noise goes", () => {
  it("non-fast-forward rejection: the WHOLE [rejected] line, the error, and the first hint", () => {
    const s = gitFailureSummary(REJECTED_FETCH_FIRST);
    assert.match(
      s,
      /! \[rejected\] chore\/add-some-space-between-btn-and-list-ac73748e -> chore\/add-some-space-between-btn-and-list-ac73748e \(fetch first\)/,
    );
    assert.match(
      s,
      /error: failed to push some refs to 'https:\/\/github\.com\/ou-pas\/legion\.git'/,
    );
    assert.match(s, /hint: Updates were rejected because the remote contains work that you do not/);
    // One hint only: the rest is prose the first one already announces.
    assert.doesNotMatch(s, /hint: 'git pull'/);
    assert.doesNotMatch(s, /Command failed/);
    assert.doesNotMatch(s, /^To https/m);
  });

  it("stale info rejection: the reason in parentheses is there", () => {
    const s = gitFailureSummary(REJECTED_STALE);
    assert.match(s, /! \[rejected\] legion\/T -> legion\/T \(stale info\)/);
    assert.match(s, /error: failed to push some refs/);
  });

  it("authentication denied: the `remote:` line naming the refusal, and the `fatal:`", () => {
    const s = gitFailureSummary(AUTH_DENIED);
    assert.match(s, /remote: Permission to ou-pas\/legion\.git denied to legion-bot\./);
    assert.match(s, /fatal: unable to access .* 403/);
    assert.doesNotMatch(s, /Command failed/);
  });

  it("a stderr without a known line keeps its END, never its start", () => {
    const noise = Array.from({ length: 200 }, (_, i) => `Counting objects: ${i}`).join("\n");
    const s = gitFailureSummary(
      `Command failed: git push\n${noise}\nthe real reason, at the very bottom`,
    );
    assert.ok(s.length <= 1_000, `capped: ${s.length}`);
    assert.match(s, /the real reason, at the very bottom$/);
    assert.doesNotMatch(s, /Counting objects: 0\b/);
  });

  it("a summary longer than the cap is cut at the START", () => {
    const longError = `error: ${"x".repeat(1_500)} final reason`;
    const s = gitFailureSummary(`Command failed: git push\n${longError}`, 300);
    assert.ok(s.length <= 300);
    assert.match(s, /final reason$/);
  });

  it("accepts an Error as well as a string, and returns an empty string for nothing", () => {
    assert.match(gitFailureSummary(new Error(AUTH_DENIED)), /denied to legion-bot/);
    assert.equal(gitFailureSummary(undefined), "");
  });
});

describe("pushRejectedBehind: the only rejection the runner can resolve alone", () => {
  it("names the reason when the remote branch moved ahead", () => {
    assert.equal(pushRejectedBehind(REJECTED_FETCH_FIRST), "fetch first");
    assert.equal(pushRejectedBehind(REJECTED_STALE), "stale info");
    assert.equal(
      pushRejectedBehind(" ! [rejected]        x -> x (non-fast-forward)"),
      "non-fast-forward",
    );
  });
  it("and returns null for everything else: no rebase on an access refusal", () => {
    assert.equal(pushRejectedBehind(AUTH_DENIED), null);
    assert.equal(pushRejectedBehind("fatal: Could not read from remote repository."), null);
  });
});

// The gesture, against real repositories.

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// The identity `configureGit` sets in the container. The runner runs git with `process.env` as is,
// and a rebase RECOMMITS: without an identity it fails before touching the remote, and we would
// think we were testing a conflict. Each test file runs in its own process.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t.local",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t.local",
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const BRANCH = "legion/T";

/** A bare remote with one commit on the run branch, and two clones of it: the previous session
 *  (`other`) and the current one (`mine`), both at the same starting point. */
function twoSessions() {
  const root = mkdtempSync(join(tmpdir(), "legion-reject-"));
  dirs.push(root);
  const seed = join(root, "seed");
  git(root, "init", "-q", "-b", BRANCH, seed);
  writeFileSync(join(seed, "a.txt"), "one\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "base");
  const remote = join(root, "remote.git");
  git(root, "clone", "-q", "--bare", seed, remote);
  const clone = (name: string) => {
    const dir = join(root, name);
    git(root, "clone", "-q", "-b", BRANCH, remote, dir);
    return dir;
  };
  return { other: clone("other"), mine: clone("mine"), remote };
}

function commitFile(dir: string, file: string, content: string, msg: string) {
  writeFileSync(join(dir, file), content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}

function io() {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  return {
    events,
    spec: {
      repoBranch: BRANCH,
      sessionId: "S1",
      agentName: "dev",
      fallbackCommitSubject: "chore: this session's work",
    },
    report: async (type: string, payload?: Record<string, unknown>) => {
      events.push({ type, payload: payload ?? {} });
    },
  };
}

const repoOf = (dir: string) => ({
  name: "legion",
  dir,
  access: "write" as const,
  baseSha: git(dir, "rev-parse", "HEAD"),
  lastCheckpoint: null as string | null,
});

describe("checkpointRepos: a push rejected because the branch moved ahead is rebased ONCE", () => {
  it("a killed session had pushed meanwhile: rebase onto it, push again, and say so", async () => {
    const { other, mine, remote } = twoSessions();
    const r = repoOf(mine);
    commitFile(other, "b.txt", "two\n", "feat: pushed by the previous session");
    git(other, "push", "-q", "origin", BRANCH);
    commitFile(mine, "c.txt", "three\n", "feat: this session's work");

    const t = io();
    await checkpointRepos(t, [r], 45);

    const remoteHead = git(remote, "rev-parse", BRANCH);
    assert.equal(git(mine, "rev-parse", "HEAD"), remoteHead, "the checkpoint is on the remote");
    assert.equal(
      git(remote, "ls-tree", "--name-only", BRANCH),
      "a.txt\nb.txt\nc.txt",
      "both pieces of work are there",
    );
    const cp = t.events.find((e) => e.type === "repo_checkpoint");
    assert.ok(cp, "the checkpoint is reported as successful");
    assert.equal(
      cp?.payload.commit,
      remoteHead.slice(0, 7),
      "and it names the sha AFTER the rebase, the one the remote carries",
    );
    assert.equal(
      r.lastCheckpoint,
      remoteHead,
      "otherwise the next turn would push the same checkpoint again",
    );
    const w = t.events.find((e) => e.type === "run_warning");
    assert.ok(w, "and the rebase is SAID, it did not happen silently");
    assert.match(String(w?.payload.message), /rejected \(fetch first\)/);
    assert.match(String(w?.payload.message), /rebas/);
  });

  it("a conflict: the rebase is aborted, the tree is restored, and the message says what to do by hand", async () => {
    const { other, mine } = twoSessions();
    const r = repoOf(mine);
    commitFile(other, "a.txt", "the other's version\n", "feat: the other session");
    git(other, "push", "-q", "origin", BRANCH);
    commitFile(mine, "a.txt", "my version\n", "feat: this session");
    const myHead = git(mine, "rev-parse", "HEAD");

    const t = io();
    await checkpointRepos(t, [r], 45);

    assert.ok(
      !existsSync(join(mine, ".git/rebase-merge")) && !existsSync(join(mine, ".git/rebase-apply")),
      "no rebase in progress: the agent finds a usable repository on the next turn",
    );
    assert.equal(git(mine, "rev-parse", "HEAD"), myHead, "HEAD is back at the session's commit");
    assert.equal(git(mine, "status", "--porcelain"), "", "clean tree");
    const w = t.events.filter((e) => e.type === "run_warning").at(-1);
    assert.ok(w, "the failure is a warning");
    const msg = String(w?.payload.message);
    assert.match(msg, /^checkpoint legion at turn 45: /);
    assert.match(msg, /rejected \(fetch first\)/, "the rejection reason is named");
    assert.match(msg, /rebase[^.]*aborted/, "and what the runner attempted");
    assert.match(msg, /git fetch origin legion\/T/, "and the manual gesture");
    assert.ok(!t.events.some((e) => e.type === "repo_checkpoint"), "no false success");
  });

  it("a refusal that is not a lag (token, missing remote) is NOT rebased, and its reason is readable", async () => {
    const { mine } = twoSessions();
    const r = repoOf(mine);
    git(mine, "remote", "set-url", "origin", join(mine, "nowhere.git"));
    commitFile(mine, "c.txt", "three\n", "feat: work");

    const t = io();
    await checkpointRepos(t, [r], 15);

    const msg = String(t.events.find((e) => e.type === "run_warning")?.payload.message);
    assert.match(msg, /^checkpoint legion at turn 15: /);
    assert.match(msg, /fatal:/, "git's decisive line is there");
    assert.doesNotMatch(msg, /Command failed/, "and not the command, which teaches nothing");
  });
});

describe("pushRepos: a rejected final push surfaces readably", () => {
  it("rebases and pushes again like the checkpoint", async () => {
    const { other, mine, remote } = twoSessions();
    const r = repoOf(mine);
    commitFile(other, "b.txt", "two\n", "feat: the other");
    git(other, "push", "-q", "origin", BRANCH);
    commitFile(mine, "c.txt", "three\n", "feat: me");

    const t = io();
    await pushRepos(t, [r]);
    assert.equal(git(mine, "rev-parse", "HEAD"), git(remote, "rev-parse", BRANCH));
    assert.ok(
      t.events.some((e) => e.type === "repo_push"),
      "reported as a successful push",
    );
    assert.ok(!t.events.some((e) => e.type === "repo_push_failed" || e.type === "run_error"));
  });

  it("a conflict on the final push: `repo_push_failed` for the notification, `run_error` for the verdict, the same reason in both", async () => {
    const { other, mine } = twoSessions();
    const r = repoOf(mine);
    commitFile(other, "a.txt", "the other\n", "feat: the other");
    git(other, "push", "-q", "origin", BRANCH);
    commitFile(mine, "a.txt", "me\n", "feat: me");

    const t = io();
    await pushRepos(t, [r]);
    const failed = t.events.find((e) => e.type === "repo_push_failed");
    const error = t.events.find((e) => e.type === "run_error");
    assert.ok(failed && error, "both events");
    assert.match(String(failed?.payload.error), /rejected \(fetch first\)/);
    assert.match(String(error?.payload.message), /final push of legion \(legion\/T\)/);
    assert.match(
      String(error?.payload.message),
      /git fetch origin legion\/T/,
      "the manual gesture is in the verdict",
    );
    assert.ok(!existsSync(join(mine, ".git/rebase-merge")), "rebase aborted");
  });
});

// Why this guard reads the source (justified in lot 11). `gitFailureSummary` is tested for real
// above. What remains is an ABSENCE in code the test cannot play: `checkpointRepos` pushes to a
// real remote, and a `.slice()` put back on an error message would only show by failing a push.
// The cut ate "(fetch first)" once; the guard keeps that from happening again silently.
describe("repos.mts: the source no longer cuts the end of a git message", () => {
  const src = readFileSync(REPOS, "utf8");
  it("no `.slice(0, N)` on a push or checkpoint error message", () => {
    const from = src.indexOf("async function checkpointRepos");
    assert.ok(from > 0);
    const tail = src.slice(from).replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(
      tail,
      /err\?\.message[^\n]*\.slice\(0,/,
      "that is exactly the cut that ate “(fetch first)”",
    );
    assert.match(tail, /gitFailureSummary\(/, "the summary goes through the function tested above");
  });
});
