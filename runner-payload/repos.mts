// repos: the runner's git domain: clone, workspace cleanup, checkpoint, push.
//
// Split from session-runner on 06/09 as is, comments included, with no behaviour change: 336 lines
// of 1,696, a third of `runReal`'s weight. Five steps that only talk to git and need two things from
// the rest of the runner: the session spec and the event log.
//
// Those travel in a carrier, `io`, passed first. Not a closure factory: one was written first and the
// AST harness rightly refused it, since a factory holding five functions is a three-hundred-line
// function under another name.
//
// It imports without side effects but runs git. Its guards are scenarios replayed against real
// repositories (push-repos.test.ts, workspace-reuse.test.ts, shallow-rebase.test.ts), plus a few
// source reads for absences no scenario can observe.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fsSync from "node:fs";
import { gitFailureSummary, pushRejectedBehind } from "./git-failure.mjs";
import type { ClonedRepo } from "./repo-grants.mjs";
import { grantedRepos, warnStrayRepos } from "./repo-grants.mjs";
import type { Report } from "./runner-io.mjs";
import type { RepoGrant, SessionSpec } from "./session-spec.mjs";
const exec = promisify(execFile);

/** The carrier: the event log, plus the part of the spec this step reads, not the whole spec. Each
 *  exported step names its fields, so a test can build exactly the spec the step needs while the
 *  compiler refuses one missing a field really read. The header says why a parameter and not a
 *  closure. */
type RepoIO<Field extends keyof SessionSpec> = { spec: Pick<SessionSpec, Field>; report: Report };

/** The clone reads grants, the run's branch, the git identity, and what cleanup must keep. */
export type SetupIO = RepoIO<
  "repos" | "repoUrl" | "repoAccess" | "repoBranch" | "gitAuthor" | "skills" | "rules"
>;

/** The checkpoint names its session in the commit subject and pushes to the run's branch. */
export type CheckpointIO = RepoIO<"repoBranch" | "sessionId"> & { nudge?: Nudge };

/** The final push adds the agent's trailer to the catch-up commit, and the fallback title under which
 *  checkpoints merge when the session made only those. */
export type PushIO = RepoIO<"repoBranch" | "sessionId" | "agentName" | "fallbackCommitSubject"> & {
  readArtifact?: ReadArtifact;
};

/** What a branch step reads from a repository (checkpoint and final push, working in an existing
 *  clone). `baseSha` is the starting point recorded at clone time: the only way to answer "has the
 *  branch moved?" rather than "is the tree dirty?", and the two differ exactly in the case that cost a
 *  session. The last two fields are the checkpoint's marks: what it already pushed, and the turn it
 *  warned on.
 *
 *  URL and credential are not here: they belong to the clone, which alone reads them. */
export type BranchRepo = {
  name: string;
  dir: string;
  access: RepoGrant["access"];
  baseSha: string | null;
  lastCheckpoint?: string | null;
  nudgedAtTurn?: number;
};

/** A repository during the session: the cloned grant plus what branch steps keep on it. What
 *  `setupRepos` returns. */
export type SessionRepo = ClonedRepo & BranchRepo;

/** The invitation to commit, before the net takes. Provided by the runner because it goes through the
 *  model's input stream, which this module does not know. */
type Nudge = (repoName: string, files: string[]) => Promise<void>;

/** A task artifact's raw content, or `null` (missing, empty, or the call failed). */
type ReadArtifact = (path: string) => Promise<string | null>;

async function git(args: string[], cwd?: string, extraEnv?: NodeJS.ProcessEnv) {
  // `extraEnv`: GIT_AUTHOR_* to replay an original commit under its own identity
  // (`squashCheckpoints`). Never for the runner's own commits, which use the globally configured
  // identity (`spec.gitAuthor`).
  return exec("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv } });
}

/** The path of a `git status --porcelain` (v1) line, without its status.
 *
 *  A `.slice(3)` copied in two places assumed `XY<space>path` on exactly three characters. Usually
 *  true, but an end-of-session net named a path missing its first character in production
 *  (`runner-payload/session-runner.mts` shown as `unner-payload/session-runner.mts`, 11/09): the
 *  separator's width is not something to take for granted. The regex relies only on what git
 *  guarantees, two status characters, and takes the whole run of spaces after them. */
export function porcelainPath(line: string): string {
  return line.replace(/^.{2}\s+/, "");
}

/**
 * The hidden price of a surviving workspace (D13), paid in least privilege.
 *
 * The container was disposable, so the question did not arise: each run started from an empty disk
 * holding only what its spec granted. A persistent workspace changes that: grants are resolved again
 * at every wake-up (the server rereads the agent row) and may have shrunk during the pause. Without
 * this cleanup a repository or skill revoked from an agent would stay readable in its workspace
 * forever: the revocation would seem to have happened everywhere except where it matters.
 *
 * Only what the current spec grants is kept. An extra folder is deleted, never the reverse: what is
 * missing is recreated right after by the clone and the skill writing.
 */
async function pruneWorkspace(io: SetupIO) {
  const { spec, report } = io;
  const cwd = process.env.LEGION_WORKDIR ?? process.cwd();
  const keep = [
    { dir: `${cwd}/repos`, allowed: new Set(grantedRepos(io).map((r) => r.name)) },
    { dir: `${cwd}/.claude/skills`, allowed: new Set((spec.skills ?? []).map((s) => s.name)) },
  ];
  // v41: rule bodies follow the same cleanup rule, but they are files, not folders, hence their own
  // loop. A rule revoked from an agent, or whose scope no longer covers its repository, must leave
  // its workspace.
  const rulesDir = `${cwd}/.claude/rules`;
  // v60: `diskPath` says where a body lands. A glob rule has a `diskPath` without a `file` (its file
  // is not cited in the prompt); filtering on `file` would delete it here at every wake-up, right
  // after it was written.
  const keptRules = new Set(
    (spec.rules ?? [])
      .map((r) => r.diskPath ?? r.file)
      .filter(Boolean)
      .map((p) => String(p).split("/").pop()),
  );
  try {
    for (const e of fsSync.readdirSync(rulesDir, { withFileTypes: true })) {
      if (!e.isFile() || keptRules.has(e.name)) continue;
      try {
        fsSync.rmSync(`${rulesDir}/${e.name}`, { force: true });
      } catch (err) {
        await report("run_warning", {
          message: `prune ${rulesDir}/${e.name} failed: ${(err as Error)?.message}`,
        });
      }
    }
  } catch {
    /* no folder = nothing to clean */
  }

  // v61: the only path hooks could come in through, erased at every start.
  //
  // The SDK reads a project's `settings.json` (so its hooks) only in `<cwd>/.claude/`, neither above
  // nor in children. Cloned repositories' `.claude/settings.json` are out of reach by construction,
  // `repos/<name>/` being a child of `cwd`. This file is not: it is exactly where the SDK reads.
  //
  // The workspace is writable by the agent, and since `settingSources: ["project"]` such hooks would
  // take effect at the next wake-up, in a session that asked for nothing: the only way an agent could
  // grant itself execution rights the spec does not, under `permissionMode: "dontAsk"`.
  //
  // Erased rather than refused: refusing would mean intercepting every write; erasing happens once
  // and depends on no guardrail someone could forget.
  for (const name of ["settings.json", "settings.local.json"]) {
    const dest = `${cwd}/.claude/${name}`;
    try {
      if (!fsSync.existsSync(dest)) continue;
      fsSync.rmSync(dest, { force: true });
      await report("run_warning", {
        message: `prune ${dest}: a settings.json in the workspace is never legitimate`,
      });
    } catch (err) {
      await report("run_warning", { message: `prune ${dest} failed: ${(err as Error)?.message}` });
    }
  }

  for (const { dir, allowed } of keep) {
    let entries;
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || allowed.has(e.name)) continue;
      try {
        fsSync.rmSync(`${dir}/${e.name}`, { recursive: true, force: true });
      } catch (err) {
        await report("run_warning", {
          message: `prune ${dir}/${e.name} failed: ${(err as Error)?.message}`,
        });
      }
    }
  }
}

/** The credential store, line by line: which host gets which token, under which name.
 *
 *  One credential per host, dictated by the spec (v29). Least privilege is unchanged (a token is
 *  only presented to hosts of repositories that require it), but no longer hard-coded here. This
 *  loop used to filter on `h === "github.com"`: a private GitLab repository could not be cloned even
 *  read-only, and preflight refused to launch an agent meant to push there. The container knows no
 *  forge; it applies a table the server sends (`credential.username` + `credential.tokenEnv`).
 *
 *  The fallback stays pinned to github.com, and that is the point. A spec without `credential` comes
 *  from before v29, when a token was never presented anywhere but github.com. Using `GITHUB_TOKEN`
 *  for any host would send a GitHub PAT to bitbucket.org or an internal server, exactly what the old
 *  filter forbade. The constant leaves the modern path, where the server says who gets what, and
 *  stays where nobody can say it any more.
 *
 *  No token (public repository, undeclared forge, secret not granted): no line, and the clone will
 *  say plainly what it lacks.
 *
 *  Pure, with the environment as a parameter: this is a safety boundary (which secret goes to which
 *  host), tested by calling it, not by rereading its source
 *  (`server/src/sessions/runner/git-credentials.test.ts`, batch 11). */
export function credentialStoreLines(
  list: readonly RepoGrant[],
  env: NodeJS.ProcessEnv,
): Map<string, string> {
  const lines = new Map<string, string>(); // host → credential store line
  for (const r of list) {
    if (!r.url.startsWith("https://")) continue;
    let host;
    try {
      host = new URL(r.url).host;
    } catch {
      continue;
    }
    if (lines.has(host)) continue;
    const username = r.credential?.username;
    const token = r.credential?.tokenEnv
      ? env[r.credential.tokenEnv]
      : host === "github.com"
        ? env.GITHUB_TOKEN || env.GIT_TOKEN
        : undefined;
    if (!token) continue;
    lines.set(
      host,
      `https://${encodeURIComponent(username ?? "x-access-token")}:${encodeURIComponent(token)}@${host}`,
    );
  }
  return lines;
}

/** What must be written before the first `git clone`: the credential store and the author identity.
 *  Split from `setupRepos` on 06/09: the function was 116 lines, and this block is about forges, not
 *  repositories.
 *
 *  Never throws: a git identity that could not be set is a warning, and the clone that follows will
 *  say plainly what it lacks.
 *
 *  @param {RepoIO} io
 *  @param {object[]} list the granted repositories, whose hosts may be presented a token
 */
async function configureGit(io: SetupIO, list: RepoGrant[]) {
  const { spec, report } = io;
  try {
    const lines = credentialStoreLines(list, process.env);
    if (lines.size) {
      const credFile = `${process.env.HOME}/.git-credentials`;
      fsSync.writeFileSync(credFile, [...lines.values()].join("\n") + "\n", { mode: 0o600 });
      await git(["config", "--global", "credential.helper", "store"]);
    }
    // Per-project git identity (v19), resolved and validated on the server (projects/git-identity.ts);
    // the container only applies it. `??` is defensive only: an old cached spec (resume after an
    // upgrade) may lack the field, never a misconfigured project, which already gets the default on
    // the server.
    await git(["config", "--global", "user.name", spec.gitAuthor?.name ?? "Legion"]);
    await git(["config", "--global", "user.email", spec.gitAuthor?.email ?? "legion@local"]);
  } catch (err) {
    await report("run_warning", {
      message: `git config failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
    });
  }
}

/** The workspace brought back to what the current spec grants, then each granted repository cloned
 *  or resumed on the run's branch. Returns the list, each with its `dir` and `baseSha`, the starting
 *  point `pushRepos` needs to know whether the branch moved.
 *
 *  @param {RepoIO} io
 *  @returns {Promise<object[]>}
 */
export async function setupRepos(io: SetupIO): Promise<SessionRepo[]> {
  const { spec, report } = io;
  await pruneWorkspace(io);
  const list = grantedRepos(io);
  if (list.length === 0) return [];
  await configureGit(io, list);
  const out: SessionRepo[] = [];
  for (const r of list) {
    const dir = `${process.env.LEGION_WORKDIR ?? process.cwd()}/repos/${r.name}`;
    // The clone is no longer unconditional (D13). Since `/workspace` survives the pause, the folder
    // may already be there, with its `node_modules` and untracked files, the whole point of the
    // mount. `git clone` into a non-empty folder fails, so this test is not an optimisation: without
    // it every wake-up would die on "destination path already exists". The existing clone is reused
    // and brought up to date.
    const reused = fsSync.existsSync(`${dir}/.git`);
    try {
      // No `--depth` (10/09). The clone used `--depth 50`, which produced the structure work's serial
      // conflicts. Reproduced on batch 4's branch: the `make fresh` gate then prescribed
      // `git pull --rebase origin main`, git needs the merge base to know which commits are already
      // upstream, that base was beyond the shallow graft, so git replayed everything visible, `main`'s
      // commits included, with new shas and add/add conflicts on identical files. Batch 4's branch
      // carried thirteen commits for seven patch-ids: #146 and #147 three times each.
      //
      // Measured on this repository (837 commits): depth 50 weighs 6.8 MB in 1.01 s, full history
      // 9.6 MB in 1.44 s. Depth saved 2.8 MB and 0.4 s and cost a broken rebase as soon as `main`
      // moved more than 50 commits during the session (60 in two days on 08-09/09).
      //
      // `--single-branch` stays; only depth goes. Depth implied it; writing it keeps the refspec narrow
      // (`+refs/heads/main:refs/remotes/origin/main`), so `pushBranch`'s reasoning on `FETCH_HEAD`
      // holds, and a repository with a thousand branches does not fetch them. Measured: 9.8 MB and
      // 1.53 s against 9.6 MB for a full clone.
      //
      // ponytail: `--filter=blob:none` if a granted repository gets big enough for weight to matter
      // (measured here: 9.4 MB, no gain, this repository is text).
      if (!reused) await git(["clone", "--single-branch", r.url, dir]);
      // A reused clone from before this fix is still shallow, and `/workspace` survives the pause:
      // without this catch-up, sessions already started would keep the defect forever. `--unshallow`
      // on a complete clone fails saying there is nothing to do, hence the explicit test rather than
      // a `catch` that would also swallow real network failures.
      else if (
        (
          await git(["rev-parse", "--is-shallow-repository"], dir).catch(() => ({ stdout: "" }))
        ).stdout.trim() === "true"
      ) {
        await git(["fetch", "--unshallow", "origin"], dir).catch(() => {
          /* network: the clone stays shallow, the rebase will say why */
        });
        await report("run_warning", {
          message: `repo ${r.name}: shallow clone caught up (--unshallow), it predated the 10/09 fix`,
        });
      }
      // Join the run's shared branch. The branch may not be in the clone yet — fetch it
      // explicitly (review P4 #1, empirically verified).
      const remote = await git(["ls-remote", "--heads", "origin", spec.repoBranch], dir).catch(
        () => ({ stdout: "" }),
      );
      if (remote.stdout.trim()) {
        // Without `--depth`: a deep fetch re-grafts the repository (the limit is set again 50 commits
        // before the branch head), and that limit is what the rebase hit.
        await git(["fetch", "origin", spec.repoBranch], dir);
        // `checkout -B` moves the branch to FETCH_HEAD without touching untracked files (no
        // `node_modules`, build or notes file). That makes waking up safe on a reused clone: the
        // previous session's work is already pushed (`pushRepos` before exit), so FETCH_HEAD holds it.
        await git(["checkout", "-B", spec.repoBranch, "FETCH_HEAD"], dir);
      } else {
        // `-B`, not `-b`: on a reused clone the branch already exists locally and `-b` would fail.
        // On a fresh clone `-B` does exactly what `-b` did.
        await git(["checkout", "-B", spec.repoBranch], dir);
      }
      // The starting point, recorded here and nowhere else. It lets `pushRepos` answer the right
      // question, "has the branch moved?", rather than "is the tree dirty?". They look alike and
      // diverge exactly in the case that cost a session: the agent commits itself, the tree is clean
      // again, and the work is visible only through this sha.
      const base = await git(["rev-parse", "HEAD"], dir).catch(() => null);
      // `reused` is reported, not just done: the only way to check D13 from a session's log without
      // opening the container.
      await report("repo_ready", {
        repo: r.name,
        branch: spec.repoBranch,
        dir: `repos/${r.name}/`,
        reused,
      });
      out.push({ ...r, dir, baseSha: base?.stdout.trim() || null });
    } catch (err) {
      // Fatal, no longer a warning (20/08). A granted repository that does not arrive is the task's
      // precondition, not a detail: carrying on produced a session "working" on nothing and returning
      // invented code. The pre-container check (server/src/sessions/preflight.ts) already catches the
      // certain cases; what remains is a read-only private repository, which cannot be guessed
      // locally, and it fails here, plainly.
      // The message names the secret expected for this forge: blaming `GITHUB_TOKEN` in front of a
      // GitLab repository sent the operator to check the wrong setting.
      //
      // And it only guesses when git said nothing (30/08). "private repository without a token" was
      // appended to every clone error, including those already carrying their remedy. Seen on
      // "detected dubious ownership": git wrote the exact command to run, and the next sentence sent
      // the operator to check a token that was granted. A guess covering a proof is worse than no
      // guess.
      const raw = String((err as Error)?.message ?? err);
      const expected = r.credential?.tokenEnv ?? "GITHUB_TOKEN";
      // Signatures of a real access refusal. Short and explicit: the hypothesis is only added in
      // front of one of them, never "just in case".
      const looksLikeAuth =
        /Authentication failed|could not read Username|Permission denied|403|Repository not found|not found|access rights/i.test(
          raw,
        );
      throw new Error(
        `repo ${r.name} ${reused ? "not refreshed (reused clone)" : "unreachable"}: ` +
          `${raw.slice(0, 300)}` +
          (looksLikeAuth ? ` — private repo without ${expected} granted to this agent?` : ""),
      );
    }
  }
  return out;
}

/** Forced push with an explicit lease (09/09): without a value, `--force-with-lease` wants a tracking
 *  ref that `fetch` updated, but this clone is single-branch, so git answers `(stale info)` and the
 *  final push always failed after a rewrite (4 sessions without a PR on 08-09/09). The remote's sha
 *  keeps the same safety; a branch unknown to the remote gives an empty lease. Both forms are proven
 *  against real repositories in `runner/push-repos.test.ts`.
 *  @param {{ name: string, dir: string }} r @param {string} branch */
async function forcedPush(r: { dir: string }, branch: string) {
  const remote = await git(["ls-remote", "--heads", "origin", branch], r.dir).catch(() => ({
    stdout: "",
  }));
  const [sha = ""] = remote.stdout.trim().split(/\s+/);
  await git(["push", `--force-with-lease=${branch}:${sha}`, "-u", "origin", branch], r.dir);
}

/** Is what the remote has beyond us only our own checkpoints?
 *
 *  Assumes a `git fetch origin <branch>` just before: reads `FETCH_HEAD`, not a tracking ref, since a
 *  session's clone is single-branch and has none.
 *
 *  False when the list is empty: then there is nothing to overwrite, the rejection comes from
 *  something other than lag, and staying quiet lets the rebase say what it was. */
async function remoteHasOnlyCheckpoints(r: BranchRepo): Promise<boolean> {
  const ahead = await git(["log", "HEAD..FETCH_HEAD", "--format=%s"], r.dir).catch(() => null);
  if (!ahead) return false;
  const { isCheckpointCommit } = await import("./checkpoint-squash.mjs");
  const subjects = ahead.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return subjects.length > 0 && subjects.every(isCheckpointCommit);
}

/** Pushes the run's branch, absorbing the only rejection solvable without a human.
 *
 *  A task's branch is pushed by successive sessions: pause then wake-up, or a killed session whose
 *  last push left while the next one was cloning (07/09, NrEQhvaC2W: the remote already had
 *  `0f36cb6`, the checkpoint was rejected twice in a row, and nobody would have known without reading
 *  the container). Then the remote branch is one or two commits ahead and nothing else: fetch,
 *  rebase onto it, push again. Once; the next turn retries anyway.
 *
 *  Rebase, not merge, because the branch is linear and that is its value: it reads commit by commit in
 *  the PR, and a "Merge remote-tracking branch 'origin/…'" made by a safety net would pass a
 *  checkpoint for an integration. Both fail on the same conflicts; there we abort and give the tree
 *  back as it was. `rebase --abort` does that; a half-done merge leaves markers the agent would read
 *  next turn as its own.
 *
 *  `FETCH_HEAD`, not `origin/<branch>`: the clone is `--single-branch` and its refspec only updates
 *  the default branch. `git fetch origin <branch>` fills FETCH_HEAD, not the remote ref (review P4 #1,
 *  already paid for in `setupRepos`).
 *
 *  Throws with a finished message (git's whole reason, what was tried, the manual step) that the
 *  caller reports as is, as `run_warning` (checkpoint) or `run_error` (final push). A refusal that is
 *  not lag (token, remote, protected branch) is not rebased: fetching a new branch would replace the
 *  real error with "couldn't find remote ref" (02/09, le2nn8MjMx4K).
 *
 *  @param {RepoIO} io
 *  @param {{ name: string, dir: string }} r
 */
async function pushBranch(
  io: RepoIO<"repoBranch">,
  r: BranchRepo,
  { force = false }: { force?: boolean } = {},
) {
  const { spec, report } = io;
  const branch = spec.repoBranch;
  // Forced after a rewrite, and the catch-up below is exactly what to avoid: commits already pushed
  // by a checkpoint vanished locally, a normal push would be rejected as non-fast-forward, and the
  // rebase would bring them back, exactly what was just erased. See `forcedPush` for the lease.
  if (force) {
    await forcedPush(r, branch);
    return;
  }
  const rejected = await git(["push", "-u", "origin", branch], r.dir).then(
    () => null,
    (e) => e,
  );
  if (!rejected) return;
  const behind = pushRejectedBehind(rejected);
  if (!behind) throw new Error(`push of ${branch} refused: ${gitFailureSummary(rejected)}`);
  const byHand = `by hand: git fetch origin ${branch} && git rebase FETCH_HEAD, resolve, then git push`;
  try {
    await git(["fetch", "origin", branch], r.dir);
  } catch (err) {
    throw new Error(
      `push of ${branch} rejected (${behind}), and the remote branch could not be read — ` +
        `${gitFailureSummary(err)} — ${byHand}`,
    );
  }
  // Our own checkpoints are not rebased, they are overwritten (14/09, task `P2BYzKpcD1`).
  //
  // `checkpointRepos` commits and pushes leftovers every fifteen turns. The agent finds its work
  // committed as "chore: checkpoint (turn N)" and naturally takes it back: `git reset --soft <before
  // the checkpoint>`, then its own commit. It just rewrote a commit already on the remote, with
  // nothing telling it.
  //
  // The next push is then rejected, and the catch-up rebase is the worst choice: it replays onto the
  // checkpoint patches the checkpoint already contains, hits empty patches and stops. Sixty turns of
  // work stayed in the dead container.
  //
  // When what is ahead of us is only checkpoints, overwriting loses nothing: a checkpoint is a net,
  // not a commit meant to survive, which is already what `squashCheckpoints` does at every session
  // end. The `--force-with-lease` lease keeps safety against a third party pushing meanwhile.
  if (await remoteHasOnlyCheckpoints(r)) {
    await report("run_warning", {
      message:
        `push of ${branch}: the remote only carried checkpoints from this session, ` +
        `overwritten rather than rebased`,
    });
    await forcedPush(r, branch);
    return;
  }
  try {
    await git(["rebase", "FETCH_HEAD"], r.dir);
  } catch (err) {
    await git(["rebase", "--abort"], r.dir).catch(() => {
      /* nothing to abort: the rebase never started */
    });
    throw new Error(
      `push of ${branch} rejected (${behind}): the remote branch moved on, the rebase onto it failed ` +
        `and was aborted, the tree is back as it was — ${gitFailureSummary(err)} — ${byHand}`,
    );
  }
  try {
    await git(["push", "-u", "origin", branch], r.dir);
  } catch (err) {
    throw new Error(
      `push of ${branch} rejected (${behind}), rebased onto origin/${branch} then refused again: ${gitFailureSummary(err)} — ${byHand}`,
    );
  }
  await report("run_warning", {
    message: `push of ${r.name} rejected (${behind}): the remote branch had moved on, rebased onto it and pushed again`,
  });
}

/** Work is pushed during the session, not only at the end.
 *
 *  Two sessions lost on 25/08 share a root, and not the obvious one: the work existed in one place, a
 *  disposable container, until the very last second. Any brutal end (turn cap, OOM, Docker going
 *  down, a cut) took everything. `pushRepos` at session end is a good last step, but a last step is
 *  only worth something if it is reached.
 *
 *  A checkpoint replaces nothing: it makes "did we reach the end cleanly?" inconsequential for the
 *  code. At worst fifteen turns are lost.
 *
 *  It never throws: a failing checkpoint (index locked because the agent runs git at the same moment,
 *  a network hiccup) is a warning, not a reason to kill a working session. The next one retries
 *  fifteen turns later.
 *
 *  It returns what it pushed (10/09): that count separates a progressing session from an inert one
 *  (inertia). The signal already existed implicitly, `repo_checkpoint` being emitted only when HEAD
 *  moved and the push went through; returning it spares rereading our own trace.
 *  @returns {Promise<number>} number of repositories where a commit was really pushed
 */
export async function checkpointRepos(
  io: CheckpointIO,
  repos: BranchRepo[],
  turn: number,
  reason = "turns",
) {
  const { spec, report, nudge } = io;
  let pushed = 0;
  for (const r of repos ?? []) {
    if (r.access !== "write") continue;
    try {
      const status = await git(["status", "--porcelain"], r.dir);
      // The net warns before taking (10/09). It committed without asking, and two damages came of it
      // the same day (task `ks1wcjyVMZ`): the agent's `git commit` answering "nothing to commit,
      // working tree clean" because the checkpoint had just taken its work in the same second, and
      // fifteen files reaching GitHub under a generic subject although the agent could name them. A
      // net catches what falls, it does not pick what is held.
      //
      // The warning costs nothing: what is already committed keeps being pushed just below, at this
      // checkpoint. Only the net's own commit waits for the next checkpoint.
      const dirty = status.stdout.trim().split("\n").filter(Boolean).map(porcelainPath);
      if (dirty.length === 0) r.nudgedAtTurn = undefined;
      else if (r.nudgedAtTurn === undefined && nudge) {
        r.nudgedAtTurn = turn;
        await nudge(r.name, dirty);
      } else {
        r.nudgedAtTurn = undefined;
        await git(["add", "-A"], r.dir);
        // Conventional type (same remedy as `pushRepos` below): nobody normally reads this message,
        // the checkpoint being a net, but if it ever landed in a read history it should carry a
        // recognised form rather than a `legion` type no convention knows.
        await git(
          ["commit", "-m", `chore: checkpoint (turn ${turn}) — session ${spec.sessionId}`],
          r.dir,
        );
      }
      const head = (await git(["rev-parse", "HEAD"], r.dir)).stdout.trim();
      // Nothing new since the clone or the last checkpoint: no useless push.
      if (head === r.baseSha || head === r.lastCheckpoint) continue;
      await pushBranch(io, r);
      // HEAD is read again after the push: a rebase may have moved it, and keeping the old sha would
      // push (and report) the same checkpoint again next turn.
      const head2 = (await git(["rev-parse", "HEAD"], r.dir)).stdout.trim();
      r.lastCheckpoint = head2;
      pushed += 1;
      // `reason` says what triggered this checkpoint (`turns`, `elapsed`, or `pause`): without it the
      // elapsed-time cadence would be indistinguishable from the turn cadence in the thread.
      await report("repo_checkpoint", {
        repo: r.name,
        branch: spec.repoBranch,
        turn,
        reason,
        commit: head2.slice(0, 7),
      });
    } catch (err) {
      // The end of the message, never the start: git writes its reason last (07/09, see git-failure).
      await report("run_warning", {
        message: `checkpoint ${r.name} at turn ${turn}: ${gitFailureSummary(err)}`,
      });
    }
  }
  return pushed;
}

/** Checkpoints do not outlive the session that made them.
 *
 *  `checkpointRepos` makes a net, not a commit meant to last, but nothing made it disappear: at an
 *  agent's pace (45 tool calls in 5 minutes) fifteen turns often pass before the first real
 *  `git commit`, and history kept anonymous commits (up to three in a row on one PR, and #123's squash
 *  title became "chore: checkpoint (turn 30)").
 *
 *  Which commits to merge, and under which subject, is a pure decision tested apart
 *  (`checkpoint-squash.mts`, like `commit-convention.mts`). Here only git execution: `commit-tree`
 *  replays each group from the tree of the last commit it stands for (a git commit is a cumulative
 *  snapshot, never a diff to replay), so no conflict risk, unlike a rebase replaying diffs.
 *
 *  Returns `true` if the branch was rewritten, the only case where the following push must be forced.
 *  Never fails loudly: a conflict, a locked index, a missing identity get the same remedy as
 *  `checkpointRepos`, a warning, and the branch goes as is. Nothing moves (`reset --soft`, last) until
 *  every commit of the plan has been replayed, so an error midway leaves the branch as it was.
 */
async function squashCheckpoints(
  io: RepoIO<"fallbackCommitSubject">,
  r: BranchRepo,
  prMdRaw: string | null,
) {
  const { spec, report } = io;
  if (r.access !== "write" || !r.baseSha) return false;
  try {
    const headBefore = (await git(["rev-parse", "HEAD"], r.dir)).stdout.trim();
    if (headBefore === r.baseSha) return false; // nothing new this session

    const log = await git(["log", "--reverse", "--format=%H%x1f%s", `${r.baseSha}..HEAD`], r.dir);
    const commits = log.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const sep = line.indexOf("\x1f");
        return { sha: line.slice(0, sep), subject: line.slice(sep + 1) };
      });
    if (!commits.length) return false;

    const { planCheckpointSquash } = await import("./checkpoint-squash.mjs");
    const plan = planCheckpointSquash(commits, {
      prMdRaw,
      fallbackTitle: spec.fallbackCommitSubject,
    });
    if (!plan.changed) return false; // no checkpoint in the range: nothing to rewrite

    let parent = r.baseSha;
    for (const g of plan.groups) {
      const tree = (await git(["show", "-s", "--format=%T", g.finalSha], r.dir)).stdout.trim();
      if (g.kind === "keep") {
        // The original commit's message and author win, never the runner's identity.
        const [an, ae, ad] = (
          await git(["show", "-s", "--date=raw", "--format=%an%x1f%ae%x1f%ad", g.finalSha], r.dir)
        ).stdout
          .trim()
          .split("\x1f");
        const message = (await git(["show", "-s", "--format=%B", g.finalSha], r.dir)).stdout;
        parent = (
          await git(["commit-tree", tree, "-p", parent, "-m", message], r.dir, {
            GIT_AUTHOR_NAME: an,
            GIT_AUTHOR_EMAIL: ae,
            GIT_AUTHOR_DATE: ad,
          })
        ).stdout.trim();
      } else {
        // `kind: "rename"`: current identity and date (configured globally, `spec.gitAuthor`), exactly
        // what an ordinary `git commit` here would use.
        parent = (
          await git(["commit-tree", tree, "-p", parent, "-m", g.subject], r.dir)
        ).stdout.trim();
      }
    }
    // The last group always stands for the range's last commit (`planCheckpointSquash`'s algorithm),
    // so its tree is `headBefore`'s, unchanged. `--soft` moves the branch without touching the index
    // or working tree, already right.
    await git(["reset", "--soft", parent], r.dir);
    return true;
  } catch (err) {
    await report("run_warning", {
      message: `checkpoint squash ${r.name}: ${gitFailureSummary(err)}`,
    });
    return false;
  }
}

/** Commits and pushes each repository that moved: the branches are the deliverable.
 *
 *  What is tested here is not tree cleanliness. It was, and that cost a whole session (25/08,
 *  HSV_FFG00R, 133 turns, $3.98): the agent had run `git add` + `git commit` itself (nothing forbids
 *  it, the end-of-task instruction almost encourages it), then this function ran `status --porcelain`,
 *  found a clean tree, concluded "nothing to deliver", reported `changes: 0` and returned. The
 *  container was destroyed within the minute with the only copy of the commit. The task went to
 *  `review` with an artifact detailing three files and six green tests, and a branch that never
 *  existed.
 *
 *  A clean tree has two opposite causes: the agent did nothing, or the agent committed everything. The
 *  old version confused them and always picked the wrong one. What separates them is "has HEAD moved
 *  since the clone?", hence `baseSha`.
 */
export async function pushRepos(io: PushIO, repos: BranchRepo[]) {
  const { spec, report, readArtifact } = io;
  // A repository the agent cloned itself is not in `repos`: this loop will not push it and the next
  // wake-up erases it. Say so before pushing the rest (repo-grants).
  await warnStrayRepos(io, repos);
  // Read once, not per repository: `pr.md` is a task artifact. Skipped when no repository is writable
  // (a read-only task pushes nothing, so merges nothing). Missing or empty → `null`, and the merge
  // falls back to the task's fallback title (`spec.fallbackCommitSubject`), never "chore: checkpoint".
  const prMdRaw =
    repos.some((r) => r.access === "write") && readArtifact ? await readArtifact("pr.md") : null;
  for (const r of repos) {
    if (r.access !== "write") continue;
    try {
      const status = await git(["status", "--porcelain"], r.dir);
      // Paths, not just the count: "24 files" says something happened, "24 files including
      // capabilities/agent-edit.ts" says what.
      const uncommitted = status.stdout.trim().split("\n").filter(Boolean).map(porcelainPath);
      if (status.stdout.trim()) {
        await git(["add", "-A"], r.dir);
        // Co-Authored-By (v19): the commit author is the project's identity (one per project, shared
        // by its agents, see projects/git-identity.ts); this trailer also records which agent produced
        // this commit, without splitting the git identity per agent. The local address
        // (agents.legion.local) is deliberately unresolvable: it must never match a real GitHub
        // account and collect an attribution it does not deserve.
        // The subject is an admission, not a disguise (02/09). Slice nav/18 composed it from the task
        // name (`spec.commitSubject`, `conventionalTitle` on the server): a real conventional type, but
        // it gave this catch-up commit, often an end-of-session grab bag, the same subject as the
        // agent's real work, already committed cleanly. Two identical commits, no way to read them
        // apart. This commit is not the work: it is the net picking up what the agent left lying
        // around, and it says so.
        await git(
          [
            "commit",
            "-m",
            `chore: end of session — uncommitted work\n\n` +
              `Session ${spec.sessionId}\n\n` +
              `Co-Authored-By: ${spec.agentName} <${spec.agentName.replace(/[^\w.-]+/g, "-")}@agents.legion.local>`,
          ],
          r.dir,
        );
        // And it says so outside a commit subject (10/09). The net picked up silently: no event, no
        // log line, so "the agent does not commit" stayed an impression nobody could date or count.
        // Measured from git on 10/09: 15 times in sixteen days, three the same morning with 24 files
        // each (the same batch redone three times, no agent commit, the session shorter than the
        // checkpoint cadence). The brief asks for atomic commits as work goes; what is not measured
        // cannot be held against the agent.
        await report("run_warning", {
          message:
            `${uncommitted.length} file(s) left uncommitted in ${r.name} — ` +
            `picked up by the end-of-session safety net: ${uncommitted.slice(0, 5).join(", ")}` +
            (uncommitted.length > 5 ? `, …` : ""),
        });
      }

      // Checkpoints merge after the catch-up, so it counts as a real commit absorbing the checkpoints
      // before it; and before the push, which must know whether history was rewritten.
      const rewrote = await squashCheckpoints(io, r, prMdRaw);

      // By now everything the agent produced is committed (by itself, by the catch-up above, or
      // merged by `squashCheckpoints`). What remains is whether it goes beyond the starting point.
      const headNow = (await git(["rev-parse", "HEAD"], r.dir)).stdout.trim();
      if (r.baseSha && headNow === r.baseSha) {
        await report("repo_push", { repo: r.name, branch: spec.repoBranch, changes: 0 });
        continue;
      }
      if (!r.baseSha) {
        // Recording at clone time failed. Push anyway: an extra branch can be deleted, a commit
        // destroyed with its container cannot be found again. The imbalance between the two errors
        // decides.
        await report("run_warning", {
          message: `repo ${r.name}: unknown starting point, pushing as a precaution`,
        });
      }
      // The rebase-and-retry of a rejected push (night review #2) lives in `pushBranch` since 07/09,
      // shared with the checkpoint: same step, same traps.
      await pushBranch(io, r, { force: rewrote });
      const head = await git(["rev-parse", "--short", "HEAD"], r.dir);
      // `changes` counts files differing from the starting point, not lines of a final `status`. The
      // old count was zero in the very case being fixed, and missed everything committed along the way.
      const diff = r.baseSha
        ? await git(["diff", "--name-only", r.baseSha, "HEAD"], r.dir).catch(() => null)
        : null;
      const changes = diff
        ? diff.stdout.trim().split("\n").filter(Boolean).length
        : status.stdout.trim().split("\n").filter(Boolean).length;
      await report("repo_push", {
        repo: r.name,
        branch: spec.repoBranch,
        commit: head.stdout.trim(),
        changes,
      });
    } catch (err) {
      // A failed push means work at risk: a dedicated event (it triggers the outgoing notification
      // and the server's log line), plus a `run_error` (07/09): that is what the task's verdict reads
      // to name the cause, and a refused final push is the cause of a missing branch. A lone
      // `repo_push_failed` stayed one trace line among others.
      const summary = gitFailureSummary(err);
      await report("repo_push_failed", { repo: r.name, branch: spec.repoBranch, error: summary });
      await report("run_error", {
        message: `final push of ${r.name} (${spec.repoBranch}) failed: ${summary}`,
      });
    }
  }
}
