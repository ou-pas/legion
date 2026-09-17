// The text of the RULES registry: dropping .md files, the suggestions waiting for a decision,
// writing one by hand, and an active rule in the list.
import { defineText } from "../../i18n/catalog.js";
import { UI_TEXT } from "../../ui/vocabulary.js";
import { plural } from "../../ui/plural.js";

export const RULES_TEXT = defineText({
  title: UI_TEXT.permission.scope.rules,

  /** The description wraps the two frontmatter keys, quoted in `code` by the component: the
   *  sentence comes in pieces so it does not swallow the inline elements. */
  descBeforeKeys:
    "Permanent instructions injected into the system prompt of sessions. One .md file = one rule (optional frontmatter:",
  descBetweenKeys: ",",
  descAfterKeys:
    ") — dropping the same name again updates it. “Default for this project” applies to the whole project, otherwise the rule is checked agent by agent (Agents page).",

  /** The two frontmatter keys added in v41, explained where the files are dropped: it is the only
   *  place you can discover them before needing them. */
  descLongRules:
    "A long file puts its instruction in one sentence under `summary:`: that is what goes into the prompt, and the whole text waits in the session workspace. `repos:` limits the rule to the named repositories.",

  /** The rank of the two sources, said where rules are managed — not only in the wiki. */
  descRepoRules:
    "A cloned repository carrying `.claude/rules/*.md` adds them to these, and a file of the same name REPLACES the project rule: for a convention, the versioned file wins. Lock a rule so that no file can replace it.",

  dropLabel: "Drop .md files (or a rules folder) here — or click to choose",
  dropHint: "One file = one rule. Dropping the same name again updates the rule.",
  noMarkdown: "No .md file in the drop — only .md and .mdc make a rule.",
  uploaded: (created: number) => `${created} ${plural(created, "rule")} uploaded or updated.`,
  suggestions: (n: number) => `${n} ${plural(n, "suggestion")} waiting for your approval`,
  /** v63 — the server cap (5 "suggested" suggestions pending per project, capabilities.ts) is not
   *  exposed by the API: this number duplicates it in the front end, just as the threshold already
   *  counts `suggested.length` for the label above. If the API ever exposes it, this file stops
   *  being the only source. */
  quotaReached:
    "Suggestion quota reached — memory will not propose a new one until one of these five is handled (approved, edited or rejected).",

  /** Two different emptinesses: "no rule" is not said the same way when suggestions are waiting. */
  emptyActiveTitle: "No active rule",
  emptyActiveBody: "The suggestions above apply to no session until they are approved.",
  emptyTitle: "No rule on this project",
  emptyBody:
    "A rule is a permanent instruction, injected into every session — drop an .md file or write one above.",
  listLabel: "Active project rules",

  row: {
    /** Writes a column of the CURRENT PROJECT; "all agents" did not say so.
     *  Same checkbox on a skill and an MCP server. */
    allAgents: "default for this project",
    collapse: "Collapse the rule content",
    expand: "See the rule content",
    delete: "Delete the rule",
    scopeWhy: "This rule only enters sessions that carry this repository",
    wholeWhy: "What this rule adds to the system prompt of every session concerned",
    summaryWhy:
      "Only the summary enters the prompt; the whole text is placed in the session workspace",
    summaryWeight: (size: string) => `summary · ${size}`,
    locked: "locked",
    lockedWhy: "No .claude/rules file from a repository can replace this rule",
    lock: "Lock: no repository file will be able to replace it",
    unlock: "Unlock: a .claude/rules file of the same name will replace it",
    /** v60 — a COUNT and not the list: five patterns on one list row would make it unreadable,
     *  and the detail reads when expanded. The title carries the patterns in full. */
    paths: (n: number) => `${n} ${plural(n, "pattern")}`,
    pathsWhy: (globs: readonly string[]) =>
      `This rule only loads when the session opens a file that matches:\n${globs.join("\n")}`,
    /** v62 — the weight of a scoped rule is the most surprising number in the row: a few dozen
     *  bytes for a 2 KB rule. It MUST say why, or it reads as a display bug. */
    scopedWeight: (size: string) => `out of prompt · ${size}`,
    scopedWhy:
      "This rule no longer weighs on the system prompt: its file is placed in the workspace, and the SDK loads it when the session opens a covered file. Only its name stays announced.",
  },

  /** The measure: what ALL the "all agents" rules add to every prompt. No screen said it, and a
   *  prompt that grows shows up nowhere. */
  weight: {
    label: (size: string) => `${size} injected into every session`,
    heavy: (size: string) =>
      `${size} injected into every session — give the longest ones a summary`,
    why: "Sum of the rules marked “default for this project”. A rule checked agent by agent only weighs on theirs.",
  },

  suggested: {
    badge: "suggested",
    approve: "Approve the rule",
    reject: "Reject",
    origin:
      "Extracted from one of your inbox answers — once approved, it becomes the default for this project.",
  },

  form: {
    open: "Write a rule",
    label: "New rule",
    nameLabel: "Title",
    namePlaceholder: "e.g. Code convention",
    contentLabel: "The rule, in full",
    contentHint: "Markdown accepted — injected as is into the system prompt.",
    summaryLabel: "Summary (optional)",
    summaryHint:
      "When filled, it is THIS that goes into the prompt; the text below waits in the session workspace. Fill it as soon as the rule runs past a few lines.",
    summaryPlaceholder: "e.g. Every API route is named in snake case. Full detail in the file.",
    /** v60 — the field says up front the two things you actually run into: patterns are relative
     *  to the workspace (so prefixed with `repos/`), and a PROCESS rule cannot be scoped by a
     *  path. Without the second sentence, you try to scope "conventional commits" on a glob, and
     *  the rule simply never loads at the right moment. */
    pathsLabel: "Only load on these files (optional)",
    pathsHint:
      "One pattern per line, relative to the session workspace — so `repos/<repository>/…`. Empty = the rule always applies. Fill it only for a rule tied to FILES: a process instruction (commits, branches, checks before delivery) must stay without a pattern.",
    pathsPlaceholder: "repos/api/app/**/*.php\nrepos/front/src/**/*.{ts,tsx}",
    contentPlaceholder:
      "e.g. Any change to the Stripe webhook must be covered by an integration test.",
    allAgents: "Make this rule the default for this project",
    cancel: UI_TEXT.cancel,
    submit: "Add the rule",
  },
});
