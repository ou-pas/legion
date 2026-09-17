// The two sources of rules, merged when the container starts.
//
// A rule can come from two places, both legitimate:
//
//   · The Legion project: a database row, edited in the screen, sometimes born from an inbox
//     suggestion, enabled agent by agent. The operator's guardrails live there.
//   · The repository: a `.claude/rules/*.md` file in the clone. The team's conventions live there,
//     maintained with the code and reviewed in PRs.
//
// The repository wins, the operator's decision (27/08): "the project takes precedence over Legion".
// For a convention that is obviously right: the versioned file is current, a database copy would
// only drift.
//
// Except for a locked rule. A repository file is written by anyone who can push, a writing agent
// included; if it could replace any rule it could loosen its own leash by committing
// `secrets-jamais-en-clair.md`. The lock is off by default and set only on the few rules that exist
// to constrain.
//
// Matching is on the name, ignoring case and surrounding spaces, not on a slug. A slug would need the
// same function on both sides of a boundary (server and payload share no code), so two
// implementations drifting one day. "Name your file like your rule" is an instruction a human
// remembers; "guess the normalisation" is not.
//
// Pure: no disk, no network. The caller scans and passes the result, which makes the merge testable
// without a fake repository.
import type { SpecRule } from "./session-spec.mjs";

/** The most a repository rule without a summary can inject.
 *
 *  Without this cap `ai-module.md` (27 kB at Acme) would come back whole into the prompt through the
 *  repository door, undoing all the work on summaries. With it, thirty-four files without
 *  frontmatter cost at worst ~15 kB, and ~3 kB once they declare `summary:`. */
export const REPO_HEAD_MAX = 400;

/** Scan caps. A repository is content we did not write: it is read with bounds, not trust. */
export const MAX_REPO_RULES = 100;
export const MAX_RULE_BYTES = 256 * 1024;

/** A repository rule as `parseRuleFile` returns it: frontmatter read, body cleaned. What identifies
 *  it in the clone (repository, path) is added by the caller, who alone knows where it came from. */
export type ParsedRule = { name: string; summary: string; body: string };
export type RepoRule = ParsedRule & { repo: string; path: string };

/** A rule ready for the prompt, whatever its source. `source` is the repository it came from, `null`
 *  for a project rule, which is what makes the difference on display. `SpecRule` fields that pass
 *  through unrendered stay optional: a project rule arrives with its `locked` and `body`, a
 *  repository rule has neither. */
export type MergedRule = {
  name: string;
  head: string;
  file: string | null;
  source: string | null;
  truncated?: boolean;
  locked?: boolean;
  body?: string | null;
  diskPath?: string | null;
};

const key = (name: string | undefined) =>
  String(name ?? "")
    .trim()
    .toLowerCase();

/** A YAML scalar, unquoted.
 *
 *  v60: unescaping only happens inside double quotes, which is the YAML rule, not a preference. In a
 *  double-quoted scalar `\"` is `"` and `\\` is `\`; in a plain scalar a backslash is a backslash, and
 *  unescaping everywhere would damage a hand-written `name: C:\path` in a repository.
 *
 *  A test demanded this function: `ruleFileText` on the server quotes and escapes (it must, a bare
 *  `:` in a name makes the document invalid), and this reader returned `Eloquent \"strict\"` where
 *  the server had written `Eloquent "strict"`. The two grammars cannot share code, so the round trip
 *  holds them together (`rules-merge.test.ts`). */
function yamlValue(raw: string): string {
  const s = String(raw).trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2)
    return s.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
    return s.slice(1, -1).replace(/''/g, "'"); // single-quoted YAML only doubles the apostrophe
  return s;
}

/** A rule file's frontmatter. Same grammar as the screen's .md upload: `name:`, `summary:` (or
 *  `description:`, the key files written for Claude Code use; accepting both lets a folder be dropped
 *  in without rewriting it).
 *
 *  `paths:` is not read, on purpose: the SDK honours it, not us. What matters here is removing the
 *  whole block from the body; a `paths:` left in the body would go into the prompt as an instruction. */
export function parseRuleFile(fileName: string, text: string): ParsedRule {
  let name = String(fileName).replace(/\.mdc?$/i, "");
  let summary = "";
  let body = String(text ?? "");
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    body = body.slice(fm[0].length);
    // `?? ""`: group 1 is the frontmatter, present whenever the regex matched, which an index does
    // not tell the type.
    const front = fm[1] ?? "";
    const n = /^name:\s*(.+)$/m.exec(front)?.[1];
    if (n) name = yamlValue(n);
    const s = /^(?:summary|description):\s*(.+)$/m.exec(front)?.[1];
    if (s) summary = yamlValue(s);
  }
  return { name, summary, body: body.trim() };
}

/** A repository rule's head: its summary, or its beginning.
 *
 *  The beginning is cut at a line end when one is within reach: a sentence truncated mid-word reads
 *  as corrupted data, not as an excerpt. */
export function repoHead(rule: { summary?: string | null; body?: string | null }): {
  head: string;
  truncated: boolean;
} {
  const summary = String(rule.summary ?? "").trim();
  if (summary) return { head: summary, truncated: false };
  const body = String(rule.body ?? "").trim();
  if (body.length <= REPO_HEAD_MAX) return { head: body, truncated: false };
  const cut = body.slice(0, REPO_HEAD_MAX);
  const nl = cut.lastIndexOf("\n");
  return { head: (nl > REPO_HEAD_MAX / 2 ? cut.slice(0, nl) : cut).trimEnd(), truncated: true };
}

/**
 * Merges project rules and repository rules.
 *
 * `projectRules`: project rules, already split on the server. Both lists are accepted absent: a spec
 * from before v42 carries none, and a tolerant reader costs nothing here.
 * `repoRules`: `{ name, summary, body, path, repo }`, as scanned in the clone.
 *
 * Returns `{ rules, overridden, blocked }`: the list to render, the names the repository replaced,
 * and those a lock refused. The last two are for saying so in the trace: a silent substitution is
 * exactly what we do not want.
 */
export function mergeRules(
  projectRules: SpecRule[] | null | undefined,
  repoRules: RepoRule[] | null | undefined,
) {
  const project = Array.isArray(projectRules) ? projectRules : [];
  const repo = Array.isArray(repoRules) ? repoRules : [];

  const byKey = new Map(project.map((r) => [key(r.name), r]));
  const overridden = [];
  const blocked = [];
  const kept = [];

  for (const r of repo.slice(0, MAX_REPO_RULES)) {
    const match = byKey.get(key(r.name));
    if (match && match.locked) {
      blocked.push({ name: r.name, repo: r.repo, path: r.path });
      continue;
    }
    if (match) overridden.push({ name: match.name, repo: r.repo, path: r.path });
    const { head, truncated } = repoHead(r);
    // An empty repository rule has nothing to say: injecting it would add a heading with no
    // instruction, which reads like a rule someone forgot to write.
    if (head) kept.push({ name: r.name, head, file: r.path, source: r.repo, truncated });
  }

  const replaced = new Set(overridden.map((o) => key(o.name)));
  const rules = [
    ...project.filter((r) => !replaced.has(key(r.name))).map((r) => ({ ...r, source: null })),
    ...kept,
  ];
  return { rules, overridden, blocked };
}

/** The system prompt's `## Rules` section, rendered once from both sources.
 *
 *  Rendered here, not on the server, because repositories only exist in the container: a server that
 *  had written its half could not remove it when a file replaces it, and the model would read two
 *  contradicting texts. */
export function renderRulesSection(rules: MergedRule[]): string {
  if (!rules || rules.length === 0) return "";
  // v62: a rule without a head is scoped by globs: its file is in the workspace and the SDK loads it
  // when the session opens a matching file. Rendering it here would say it twice, precisely the
  // weight we are moving out of the prompt.
  //
  // It still went through `mergeRules`, as it must: its lock must keep arbitrating a repository file
  // of the same name. Only rendering ignores it.
  const scoped = rules.filter((r) => !r.head);
  const shown = rules.filter((r) => r.head);
  if (shown.length === 0 && scoped.length === 0) return "";
  const body = shown
    .map((r) => {
      const origin = r.source ? ` (from repo ${r.source})` : "";
      const more = r.file
        ? `\nFULL TEXT: ${r.file} — read it before you work on this subject.${r.truncated ? " (the text above is only its beginning)" : ""}`
        : "";
      return `### ${r.name}${origin}\n${r.head}${more}`;
    })
    .join("\n\n");

  // v62: say they exist without saying them. A scoped rule leaves the prompt, so a front-end agent
  // could believe no convention covers `web/` and invent one. One line closes that: it names the
  // scoped rules without carrying their text. About a hundred bytes against several kilobytes.
  const conditional = scoped.length
    ? `\n\n### Rules that load when they apply\n` +
      `These are ALSO non-negotiable. Their text is not here: each one is a file in ` +
      `\`.claude/rules/\`, loaded automatically the moment you open a file it covers. ` +
      `You do not need to read them yourself — but know they exist, and do not invent a ` +
      `convention where one of them already rules:\n` +
      scoped.map((r) => `- ${r.name}${r.source ? ` (from repo ${r.source})` : ""}`).join("\n")
    : "";

  if (!body)
    return conditional ? `## Rules (non-negotiable, apply to ALL your work)${conditional}` : "";
  return `## Rules (non-negotiable, apply to ALL your work)\n${body}${conditional}`;
}
