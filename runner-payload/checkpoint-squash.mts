// Checkpoints do not outlive the session that made them.
//
// `checkpointRepos` (repos.mts) commits `chore: checkpoint (turn N) — session X` every
// CHECKPOINT_EVERY_TURNS turns on whatever is uncommitted: a net against loss (two sessions lost on
// 25/08), not a commit meant to survive. At an agent's pace, fifteen turns often pass before its own
// "edit → check → commit" cycle: the checkpoint steals the agent's commit and history keeps anonymous
// commits (05/09, PRs #122 and #123, a squash title that became "chore: checkpoint (turn 30)").
//
// This module decides what to rewrite and into what, like commit-convention: no git knowledge, no
// command, a commit range in and a merge plan out. The orchestration (git log, git commit-tree, git
// push --force-with-lease) lives in `squashCheckpoints` (repos.mts), the payload's only place that
// talks to git.
//
// The rule, three cases covered by one algorithm: a real commit (anything not a checkpoint) absorbs
// the checkpoints before it, since its tree already contains them (commits are cumulative snapshots,
// not diffs to replay):
//   1. checkpoint(s) then a real agent commit → one commit, the agent's message and author win.
//   2. only checkpoints (the agent committed nothing) → one commit under the task's title, never
//      "chore: checkpoint".
//   3. checkpoint(s) after the last real commit (work started, never committed) → a commit named for
//      what it is, not for the turn it was made on.
export const TRAILING_SUBJECT = "chore: work left uncommitted at end of session";

/** The shape `checkpointRepos` writes. Turn number and session id vary, the shape does not. Not
 *  filtered on the current session: a task resumed several times carries checkpoints from older
 *  sessions, never cleaned before this module, which must go just the same. */
// `tour` is the French spelling written before the switch to English: a resumed task still carries it.
const CHECKPOINT_SUBJECT = /^chore: checkpoint \((?:turn|tour) \d+\) — session \S+$/;

/** A commit of the range to rewrite, as `repos.mts` reads it from `git log`. */
export type Commit = { sha: string; subject: string };

/** What the caller knows and this module does not fetch: the report the agent wrote, and the
 *  fallback title computed on the server. */
export type SquashOpts = { prMdRaw?: string | null; fallbackTitle?: string | null };

/** A group of the final sequence: keep the commit as is, or redo one under this subject. `finalSha`
 *  is the last original commit the group stands for. */
export type SquashGroup =
  | { kind: "keep"; finalSha: string }
  | { kind: "rename"; finalSha: string; subject: string };

export type SquashPlan = { changed: boolean; groups: SquashGroup[] };

/** Does a commit's subject (first line) come from `checkpointRepos`? */
export function isCheckpointCommit(subject: string | null | undefined): boolean {
  // `?? ""`: `split` always returns at least one element, which its type does not say.
  return CHECKPOINT_SUBJECT.test(String(subject ?? "").split("\n", 1)[0] ?? "");
}

/** The first non-empty line of a text, stripped of a Markdown heading (`# `).
 *
 *  Same reading as `parseAgentDraft` on the server (`server/src/review/pr-draft.ts`): the halves share
 *  no type, so they must at least share the rule. A `pr.md` starting with an empty line has no title
 *  and falls back. */
function titleLine(raw: string | null | undefined): string | null {
  for (const line of String(raw ?? "").split("\n")) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t) return t;
  }
  return null;
}

/** The final commit's subject when the session made no real commit: the first line of `pr.md` if
 *  the agent wrote it, otherwise the fallback title, `conventionalTitle(branch, task.name)`
 *  (`server/src/review/pr-draft.ts`), computed on the server and sent in the spec
 *  (`fallbackCommitSubject`). Not recomputed here: duplicating a naming rule across two languages is
 *  exactly what we avoid. */
export function squashOnlySubject(
  prMdRaw: string | null | undefined,
  fallbackTitle: string,
): string {
  return titleLine(prMdRaw) ?? fallbackTitle;
}

/**
 * The rewrite plan for a commit range, oldest (right after the starting point) to newest (HEAD).
 *
 * `commits`: `[{ sha, subject }]`, in that order.
 * `opts.prMdRaw`: raw content of `pr.md`, or `null`/`undefined` if it does not exist.
 * `opts.fallbackTitle`: the fallback title (see `squashOnlySubject`).
 *
 * Returns `{ changed, groups }`:
 *   - `changed` is `false` when the range has no checkpoint: nothing to rewrite (`groups` is then
 *     1:1 `kind: "keep"`, to stay total without a special case in the caller).
 *   - `groups` is the final commit sequence, in order. Each group carries `finalSha`, the sha of the
 *     last original commit it stands for (its tree is enough, a git commit being a cumulative
 *     snapshot), and:
 *       · `{ kind: "keep" }`: reuse the message and author of commit `finalSha`;
 *       · `{ kind: "rename", subject }`: a new commit under this subject, current git identity.
 */
export function planCheckpointSquash(
  commits: Commit[] | null | undefined,
  opts: SquashOpts = {},
): SquashPlan {
  const list = Array.isArray(commits) ? commits : [];
  const anyCheckpoint = list.some((c) => isCheckpointCommit(c.subject));
  if (!anyCheckpoint)
    return { changed: false, groups: list.map((c) => ({ kind: "keep", finalSha: c.sha })) };

  const groups: SquashGroup[] = [];
  let pending: string[] = []; // consecutive checkpoint shas not yet absorbed by a real commit
  let sawRealCommit = false;
  /** The last real commit's subject: decides below whether the report's title would duplicate it. */
  let lastRealSubject: string | null = null;
  for (const c of list) {
    if (isCheckpointCommit(c.subject)) {
      pending.push(c.sha);
      continue;
    }
    lastRealSubject = (String(c.subject ?? "").split("\n", 1)[0] ?? "").trim();
    // A real commit absorbs the checkpoints before it (case 1): their content is already in its tree.
    pending = [];
    sawRealCommit = true;
    groups.push({ kind: "keep", finalSha: c.sha });
  }
  // The queue's last element is the condition: `at(-1)` returns `undefined` exactly when it is
  // empty, which `pending.length` said without the type being able to follow.
  const finalSha = pending.at(-1);
  if (finalSha) {
    // Case 3 also takes the `pr.md` title (10/09). It used a hard-coded `TRAILING_SUBJECT`, true but
    // uninformative: on task `ks1wcjyVMZ` fifteen files, all the work, reached GitHub under "chore:
    // work left uncommitted at end of session" while `pr.md` opened with "feat(customers): tool
    // params speak {{ variables, like the rest of the app". The report could name the commit; the
    // commit did not ask.
    //
    // Same rule as case 2, with one reservation: if the report's title is already the last real
    // commit's subject, two commits in a row would carry it and history would stop reading well.
    // There, and only there, the admission beats the copy.
    const reportTitle = titleLine(opts.prMdRaw ?? null);
    const subject = sawRealCommit
      ? reportTitle && reportTitle !== lastRealSubject
        ? reportTitle
        : TRAILING_SUBJECT
      : // Fallback of the fallback: `fallbackTitle` always comes from the spec in practice
        // (`fallbackCommitSubject`); this value only keeps things total if the caller omits it.
        squashOnlySubject(opts.prMdRaw ?? null, opts.fallbackTitle ?? "chore: session work");
    groups.push({ kind: "rename", finalSha, subject });
  }
  return { changed: true, groups };
}
