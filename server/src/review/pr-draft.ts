// A change request's title and body, and the fallback when the agent wrote nothing (slice nav/12,
// product rule of 30/08: every task that writes code ends in a PR).
//
// `pr.md` used to be a condition: without it, `POST /api/tasks/:id/pr` returned 422 ("the agent
// must write the PR draft first"). But the agent is only asked for it when the step declares
// expected artifacts, so never on a task run on its own. On 30/08 a session pushed six files and a
// branch and left no PR: a missing nicety had become a blocker.
//
// It is now a preference. When it exists it wins: the agent read the diff, its title beats ours.
// When it does not, title and body are built from what the server has: the task name, its brief,
// the pushed repositories and commits. A PR without a hand-written description beats no PR,
// because it can be reviewed and completed.
//
// This module is pure (no database, file or network), which makes the fallback testable without a
// forge or a container.
//
// The title is conventional (slice nav/18, incident of 01/09). The fallback used to say
// `legion: <task name>`, and `legion` is a conventional type nowhere: a conventional-commit check in
// the target repositories' CI refused the PR on it, followed by thirteen minutes of manual repair.
// Slice 15 had fixed the same fault on branches and left titles alone.
//
// The type is read from the task branch, already the source of truth (`task-branch.ts`). Deriving
// it again from `task.type` would make two truths that diverge on a fix task, which pushes to the
// branch of the PR it fixes.
import { commitTypeOfBranch } from "../tasks/task-branch.js";

/** A repository the session really pushed to, as the runner's `repo_push` event reports it
 *  (`runner-payload/session-runner.mjs`). `changes` counts files differing from the branch's start
 *  point, not the lines of a final `git status`. */
export type PushedRepo = { repo: string; commit: string | null; changes: number };

export type PrDraft = { title: string; body: string };

/** A PR title is read in a list; beyond this GitHub and GitLab truncate it themselves, badly. The
 *  bound lives here rather than at the caller because it also applies to the agent's title: a
 *  `pr.md` whose first line is a paragraph exists. */
const TITLE_MAX = 72;

/** The brief copied into the body is capped: it comes from a human or an agent, so it has no
 *  guaranteed size, and a PR body has one (65,536 on GitHub). Truncating and saying so beats a
 *  refused call nobody understands. */
const BRIEF_MAX = 4000;

/** The conventional title shape: a type, optional scope, optional `!`, then `: ` and something.
 *  conventionalcommits.org's grammar restricted to a single-line title, and the only expression of
 *  the format in this repository. It recognises (target repository examples, an already
 *  conventional task name), never refuses: format checking belongs to the target repository's CI.
 *
 *  `|` alternations in the scope are excluded with the rest: GitLab allows `feat(a|b):`, nobody
 *  writes it, and a class too wide would accept `[WIP] fix(…)` as conforming. */
export const CONVENTIONAL_TITLE = /^[a-z][a-z0-9]*(\([^()\n]+\))?!?: \S/;

/** Below half the limit, cutting at the separator threw away more than it kept, so cut inside the
 *  word instead. Not theoretical: "chore:" followed by a 90-character identifier with no space gave
 *  "chore:…", a title that says nothing. A cut word reads badly; an empty title does not read. */
const TITLE_MIN_KEPT = Math.floor(TITLE_MAX / 2);

/** Cuts a too-long title at the last separator, never mid-word.
 *
 *  `slice(0, 72)` cut at the character and gave "…Extract the wrapp…". A truncated word reads as a
 *  typo and costs a review round trip; one word fewer costs nothing. */
function clampTitle(raw: string): string {
  const one = raw.replace(/\s+/g, " ").trim();
  if (one.length <= TITLE_MAX) return one;
  const cut = one.slice(0, TITLE_MAX - 1);
  // Separators are the space and the joiners a title really carries: `-`, `/`, `·`, `—`. The dot is
  // not one: "v1.2" and "i18n.ts" would be cut in the middle.
  const atSeparator = cut.replace(/[^\s/·—-]*$/, "").trimEnd();
  return `${(atSeparator.length >= TITLE_MIN_KEPT ? atSeparator : cut).trimEnd()}…`;
}

/**
 * The certain title, offline: `<type>: <task name>`, with the type read from the branch.
 *
 * It needs no network or token, which makes it level 1 of the slice: enough to pass the CI check.
 * Level 2 (examples from the target repository, mounted in the session prompt) refines it rather
 * than replacing it, and when level 2 fails this one remains, which is exactly what we want.
 *
 * An already conventional task name is not re-prefixed: "fix: the button stays active" must not
 * become "chore: fix: the button stays active". The function is idempotent.
 */
export function conventionalTitle(branch: string, name: string): string {
  const one = name.replace(/\s+/g, " ").trim();
  return clampTitle(CONVENTIONAL_TITLE.test(one) ? one : `${commitTypeOfBranch(branch)}: ${one}`);
}

function clampBrief(raw: string): string {
  const brief = raw.trim();
  return brief.length > BRIEF_MAX
    ? `${brief.slice(0, BRIEF_MAX).trimEnd()}\n\n(brief truncated)`
    : brief;
}

/** The agent's draft: first line = title (Markdown `#` removed), the rest = body. Same reading as
 *  `parsePrDraft` on the screen side (`web/src/tasks/pr-state.ts`): the two halves share no type, so
 *  they must at least share the rule. */
function parseAgentDraft(raw: string): PrDraft {
  const lines = raw.trim().split("\n");
  return {
    title: clampTitle((lines[0] ?? "").replace(/^#+\s*/, "")),
    body: lines.slice(1).join("\n").trim(),
  };
}

/** One line per pushed repository: name, file count, head commit. What a reviewer looks for first
 *  when nobody wrote a description. */
function pushedLines(pushed: readonly PushedRepo[]): string {
  return pushed
    .map(
      (p) =>
        `- \`${p.repo}\` — ${p.changes} file${p.changes === 1 ? "" : "s"}${p.commit ? ` · \`${p.commit}\`` : ""}`,
    )
    .join("\n");
}

/**
 * A task's PR draft.
 *
 * `draft` is the content of `pr.md`, or `null` if it does not exist. An empty (or blank) file counts
 * as absent: it brings no title or body, and preferring it to the fallback would open an untitled
 * PR, exactly what we are trying to avoid.
 *
 * `endReason` is only set when the session stopped in failure. The end status does not decide
 * whether to open, it decides the shape: pushed work is reviewable even when the session stalled,
 * but the reason must be in the body, or the reviewer believes the work is finished.
 *
 * `branch` is the task branch (`taskBranch`), used for the fallback title's type. The caller
 * already knows it (it passes it to the forge in the same call), so asking for it costs nothing
 * and keeps this module from deriving it a second time.
 */
export function prDraft(opts: {
  draft: string | null;
  task: { name: string; description: string };
  branch: string;
  pushed: readonly PushedRepo[];
  endReason?: string | null;
}): PrDraft {
  const fallback = conventionalTitle(opts.branch, opts.task.name);
  const written = opts.draft?.trim() ?? "";
  if (written) {
    const parsed = parseAgentDraft(written);
    // A `pr.md` starting with an empty line has no title: give it the fallback's rather than open
    // an unnamed change request.
    if (parsed.title) return parsed;
    return { title: fallback, body: parsed.body };
  }
  return { title: fallback, body: fallbackBody(opts) };
}

function fallbackBody(opts: {
  task: { name: string; description: string };
  pushed: readonly PushedRepo[];
  endReason?: string | null;
}): string {
  const parts: string[] = [];
  const brief = clampBrief(opts.task.description);
  if (brief) parts.push(brief);
  if (opts.pushed.length) parts.push(`## Pushed on this branch\n\n${pushedLines(opts.pushed)}`);
  const why = opts.endReason?.trim();
  // The session stalled: say it here, in the body. Opening nothing would leave an orphan branch
  // nobody finds; opening without saying so would make interrupted work read as finished.
  if (why)
    parts.push(
      `## The session did not end normally\n\n${why}\n\nThe pushed code is here and can be reviewed here.`,
    );
  parts.push(
    "---\n\nOpened automatically by Legion — the agent did not drop a `pr.md`. Title and body " +
      "come from the task and the pushed repos: complete them by hand if needed.",
  );
  return parts.join("\n\n");
}

// Level 2: the convention read from the target repository.
//
// No hard-coded convention can be right for two repositories at once. Two repositories of one
// project, measured on a real fleet, do not put the issue identifier in the same place:
// `refactor: … (AI-2142)` in one, `feat(integrations): AI-2109 …` in the other. A hand-entered
// setting would go stale the day their style moves; their latest merged titles would not.
//
// Examples, not prose: an example shows language, scope and identifier placement at once, three
// things a describing sentence leaves open. The shape itself comes from the
// `commits-conventionnels` rule stored in the database for both projects: this module does not
// write a third copy.

/** Enough examples for a constant to show (language, scope, identifier placement), few enough not
 *  to drown the prompt. Beyond six, one counts rather than reads. */
const TITLE_EXAMPLES_PER_REPO = 6;

/** The conforming titles of a list, deduplicated, in received order (newest first).
 *
 *  The filter is the point: non-conventional titles exist in a repository (older than its CI, or
 *  through a path that dodges it), and showing them as examples would teach exactly what we are
 *  correcting. */
export function conventionalTitles(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of titles) {
    const one = raw.replace(/\s+/g, " ").trim();
    if (CONVENTIONAL_TITLE.test(one)) seen.add(one);
    if (seen.size >= TITLE_EXAMPLES_PER_REPO) break;
  }
  return [...seen];
}

/** The prompt section carrying the examples, or the empty string when there are none.
 *
 *  The empty string is the normal answer of everything that failed: repository without history,
 *  missing token, network down, all titles non-conforming. The caller pastes it as is: nothing to
 *  decide, so nothing to forget. A repository nothing was read from does not appear at all rather
 *  than appearing empty, which would read as "this repository has no convention". */
export function titleExamplesPrompt(
  byRepo: readonly { repo: string; titles: readonly string[] }[],
): string {
  const blocks = byRepo
    .map((r) => ({ repo: r.repo, titles: conventionalTitles(r.titles) }))
    .filter((r) => r.titles.length > 0)
    .map((r) => `${r.repo}:\n${r.titles.map((t) => `  ${t}`).join("\n")}`);
  if (blocks.length === 0) return "";
  return (
    `## How these repositories title their pull requests\n` +
    `The most recent merged titles, read from each repository. Match their SHAPE — the language ` +
    `they are written in, whether they carry a scope, and where the issue identifier goes. ` +
    `They differ from one repository to the next, so follow the ones of the repository you pushed to.\n\n` +
    blocks.join("\n\n")
  );
}
