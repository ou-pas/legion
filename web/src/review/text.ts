// The text of the review domain: the pre-review of a branch (the diff commented line by line)
// and the Reviews screen (the open PRs and their GitHub comments).
//
// Several sentences are CUT by an element: "Pre-review of <b>branch</b> — …", "Add the secret
// <Code>GITHUB_TOKEN</Code> in Settings › Secrets & identity …". They stay cut — gluing them
// back into a single string would remove the element and change the rendering. So the catalog
// carries both pieces, `before` and `after`, never a sentence that lies about its shape.
import { defineText } from "../i18n/catalog.js";
import { plural } from "../ui/plural.js";

export const REVIEW_TEXT = defineText({
  /** The diff of a branch, before any PR — the critique loop: click the line, type. */
  diff: {
    loading: "loading the diff…",
    introBefore: "Pre-review of ",
    introAfter:
      " — click a line to comment on it (shift+click for a range); sending starts the agent again on ITS branch, before any PR.",
    refresh: "Reload the diff from the forge",
    /** Sending costs a session → two steps (ConfirmAction), like the kill switch. */
    send: (count: number) => `Send to the agent (${count})`,
    sendConfirm: "Run a session again with this review?",
    sendAnnounce: (count: number) =>
      `Sending ${count} ${plural(count, "comment")}: the agent resumes its branch. Confirm or cancel.`,
    repoError: (repo: string, error: string) => `${repo}: ${error}`,
    emptyTitle: "Nothing to review",
    emptyWhy:
      "The branch has not been pushed to any repo of the project — the agent published nothing (or the task has not run yet).",
    repo: (repo: string) => `repo ${repo}`,

    commentPlaceholder: "Your comment for the agent…",
    commentLabel: (path: string, line: string) => `Comment on ${path} line ${line}`,
    comment: "Comment",
    cancel: "Cancel",
    /** A range (shift+click) is stated BEFORE the field: we comment on lines, not on a line. */
    rangeCaption: (start: number, end: number) => `comment on lines ${start} to ${end}`,
    /** The mouse gesture (extend the range) — the send shortcut now lives ON the "Comment"
     *  button (`Button` `shortcut`, `UI_TEXT.submitShortcut`), not here: the two were only
     *  together because the caption could live in one place only. */
    extendHint: "shift+click another line to extend",

    /** The map of the diff: on a big diff everything is collapsed, the tree says where to go. */
    treeLabel: "Files in the diff",
    collapseAll: "Collapse all",
    fileCount: (n: number) => `${n} ${plural(n, "file")} — click to expand`,
    treeComments: (n: number) => `${n} ${plural(n, "comment")}`,

    removeFailed: "Comment not removed",
    queuedTitle: "Review queued",
    queuedBody: (count: number) =>
      `Capacity full — the task will start again on its own with your ${count} ${plural(count, "comment")}.`,
    sentTitle: "Review sent",
    sentBody: (count: number) =>
      `The agent resumes its branch with ${count} ${plural(count, "comment")}.`,
    sendRefused: "Send refused",
  },

  /** ONE file of the diff: its header, its lines, the comments anchored underneath. */
  file: {
    /** null = patch omitted by the forge (binary, file too large, collapsed diff) — said, not
     *  guessed. */
    noPatch: "patch unavailable — binary file, or too large for the compare API",
    sent: "sent",
    removeComment: "Remove this comment (not sent yet)",
    /** A comment posted on a RANGE recalls which one — the widget is anchored to a single line,
     *  the caption carries the rest. */
    lines: (start: number, end: number) => `lines ${start} to ${end}`,
    comments: (n: number) => `${n} ${plural(n, "comment")}`,
  },

  /** The state of a PR attached to a task. */
  pr: {
    /** The two labels of the `PrActions` block, shared by the PR view and the channel panel.
     *  "Open" and not "Create": on the Legion side the PR exists as soon as a branch is pushed,
     *  what we ask the forge for is to OPEN it. "Reopen / find" when there is already one: the
     *  server returns the existing one instead of making a second, and the label has to say so
     *  before the click, not after. */
    create: "Open the PR",
    recreate: "Reopen / find the PR",
    open: "open",
    created: "created",
    existing: "already existed",
    // Real state of the PR on the forge (replaces the fixed "open" label once prState is there)
    stateOpen: "open",
    stateMerged: "merged",
    stateClosed: "closed",
    stateDraft: "draft",
    /** The full sentence behind the chip: the word alone says the state, the title says what it
     *  means for the change request. */
    stateOpenTitle: "This change request is open.",
    stateMergedTitle: "This change request was merged.",
    stateClosedTitle: "This change request was closed without merging.",
    /** The mark as a single icon (`pr-mark.tsx`): the word is no longer shown, it stays in the
     *  accessible name — "PR #112 — open". */
    mark: "PR",
  },

  /** The MERGE state of a PR (`MergeState`) — distinct from the state above, which only speaks
   *  of its creation. `unknown` covers two causes we never tell apart on screen: GitHub computes
   *  `mergeable` in the background (value `null` while it runs), and a port that has not managed
   *  to reach the forge yet. Both are said the same way: "not known yet" is never "no
   *  conflict". */
  merge: {
    // Compact forms for the merge state chip (icon + short word, full title on hover)
    mergeable: "mergeable",
    conflict: "conflict",
    unknown: "pending",
    // Full forms for the hover explanation and for screen readers
    mergeableTitle: "This PR can be merged into the default branch.",
    conflictTitle: "This PR conflicts with the default branch.",
    unknownTitle: "The merge state is still being computed, or unavailable.",
  },

  /** The button that runs a session again to resolve a conflict — offered only on `"conflict"`,
   *  never on `"unknown"` (see `merge-state.ts`): acting on an uncertainty would be worse than
   *  showing nothing. */
  conflict: {
    resolve: "Resolve the conflicts",
    explain: (repo: string, number: number) =>
      `Runs a session again on this task: it fetches the default branch, merges it into its own, resolves the conflicts while preserving both intentions, re-checks the project, and pushes — on ${repo}#${number}.`,
    failed: "The rerun was refused",
    launched: (repo: string, number: number) =>
      `Session started again to resolve the conflict on ${repo}#${number}.`,
  },

  /** The button that runs a session again to fix a red CI job — sister of `conflict` above, on
   *  the other probe (`checkState`). Offered only on `"failing"`, never on `"pending"` nor
   *  `"unknown"` nor on its absence (see `pr-tab.tsx`). */
  fixCi: {
    resolve: "Fix the CI",
    explain: (repo: string, number: number) =>
      `Runs a session again on this task: it reads the red job of ${repo}#${number} and the tail of its log, pushes a fix and re-checks.`,
    failed: "The rerun was refused",
    launched: (repo: string, number: number) =>
      `Session started again to fix the CI of ${repo}#${number}.`,
  },

  /** The Reviews screen: the open legion/* PRs and their comments. */
  page: {
    title: "Reviews",
    refresh: "Refresh",
    // The subtitle lives in the body and not in the header: the refresh button would slot in
    // between.
    sub: "Open legion/* PRs and their comments — a comment becomes a fix task.",
    loading: "Loading GitHub PRs…",

    // The server names the missing secret: this is an empty state with a way out, not a failure.
    noTokenTitle: "No GitHub token on this project",
    noTokenAction: "Open Settings",
    noTokenBefore: "Add the secret ",
    noTokenAfter:
      " in Settings › Secrets & identity (fine-grained PAT covering the project repos, pull requests scope) to read the PRs and their comments.",

    failedTitle: "The GitHub PRs could not be read",
    failedWhy:
      "The call to the GitHub API failed: no PR is shown, and no fix task can be created from this page until it goes through.",
    retry: "Retry",
    checkSecret: "Check the secret",

    noPrTitle: "No open legion/* PR",
    noPrWhy:
      "Every branch pushed by the agents has been merged or closed — nothing is waiting for your review.",

    commentCount: (count: number) => `${count} ${plural(count, "comment")}`,
    branch: (branch: string) => `Branch ${branch}`,
    noComment: "No comment on this PR yet.",
    commentList: (repo: string, number: number) => `Comments on ${repo}#${number}`,
    commentSub: (author: string, path: string) => `${author} · ${path}`,
    openOnGitHub: (author: string) => `Open ${author}'s comment on the forge`,
    createFixTask: "Create a fix task",
  },

  /** The prefilled fix task: it reuses the SAME branch as the PR. */
  fix: {
    title: (repo: string, number: number) => `Fix task · ${repo}#${number}`,
    defaultName: (repo: string, number: number, excerpt: string) =>
      `Fix ${repo}#${number}: ${excerpt}`,
    /** The brief sent to the agent: it quotes the comment, it does not summarize it. An object
     *  rather than six positions — two neighbouring strings used to swap without anything
     *  saying so. */
    brief: (c: {
      author: string;
      repo: string;
      number: number;
      path: string;
      body: string;
      url: string;
    }) =>
      `Review comment by ${c.author} on ${c.repo}#${c.number}${c.path}:\n\n> ${c.body}\n\n${c.url}`,
    briefPath: (path: string) => ` (${path})`,
    commentBlock: (author: string) => `Comment by ${author}`,
    // The FORM labels ("Cancel", "Create", the field names, the two checkboxes) left for
    // `tasks/text/quick-task.ts` on 06/09 with the popup itself: they were written here AND in
    // the Issues screen catalog, word for word.
    branchBefore: "The agent will work on branch ",
    branchAfter: " — its push will update the PR, without opening a new one.",
  },
});
