// What a rule weighs in the system prompt, seen from the screen.
//
// Deliberate mirror of `server/src/capabilities/rule-scope.ts`. The two halves cannot share code
// (same boundary as `hostAllowed` reproducing tinyproxy's filter), so the rule is written out here
// so a divergence shows:
//
//   globs set          → the head is empty: the file carries the rule, the SDK loads it (v62)
//   summary set        → the head is the summary, the body goes to the session's disk
//   neither            → the head is the whole body (historical behaviour)
//
// A screen announcing a weight different from what is sent is useless: people stop believing it,
// then stop looking. That is what makes this duplication acceptable and this comment mandatory.
import type { Rule } from "../api/capabilities.js";

/** The text really sent into the prompt for this rule.
 *
 *  v62: globs come first, and the order is the contract: a scoped rule does not go into the prompt,
 *  even with a summary. The two mechanisms do not stack: the summary shortens what is injected,
 *  the glob removes the injection. */
export function ruleHead(rule: Pick<Rule, "summary" | "content" | "paths">): string {
  if (rulePaths(rule).length > 0) return "";
  return rule.summary.trim() || rule.content.trim();
}

/** `true` when the body goes to the session's disk instead of the prompt. */
export function hasBody(rule: Pick<Rule, "summary" | "paths">): boolean {
  return rulePaths(rule).length === 0 && rule.summary.trim().length > 0;
}

/** The UTF-8 bytes injected for this rule, section header included: same formula as `promptBytes`
 *  server side, otherwise the displayed figure would not be the one that counts. */
export function ruleBytes(rule: Pick<Rule, "name" | "summary" | "content" | "paths">): number {
  return new TextEncoder().encode(`### ${rule.name}\n${ruleHead(rule)}\n\n`).length;
}

export function totalRuleBytes(
  rules: readonly Pick<Rule, "name" | "summary" | "content" | "paths">[],
): number {
  return rules.reduce((n, r) => n + ruleBytes(r), 0);
}

/** Beyond this, the system prompt starts costing on every turn of every session of the project. A
 *  landmark, not a limit: nothing is refused, the screen flags it. A blocking value with no measured
 *  real cost would be made up. */
export const RULE_BYTES_WARN = 20 * 1024;

/** A rule's repositories, or an empty list when it applies everywhere. */
export function ruleRepos(rule: Pick<Rule, "repoNames">): string[] {
  try {
    const v = JSON.parse(rule.repoNames) as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** A rule's globs (v60), or an empty list when it applies at all times. Same tolerant reading as
 *  `parseGlobs` server side: broken JSON gives an empty list, never an error; the screen must keep
 *  showing the rule. */
export function rulePaths(rule: Pick<Rule, "paths">): string[] {
  try {
    const v = JSON.parse(rule.paths ?? "[]") as unknown;
    return Array.isArray(v) ? (v as string[]).filter((g) => typeof g === "string") : [];
  } catch {
    return [];
  }
}

/** One glob per line, never comma-separated.
 *
 *  A Claude Code brace contains commas: `src/**\/*.{ts,tsx}` is one pattern, and splitting on the
 *  comma would give two broken ones (`…{ts` and `tsx}`) matching nothing, silently. A newline is
 *  also their frontmatter form, so copy-pasting from a `.md` works as is. */
export function splitGlobs(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((g) => g.trim())
        .filter(Boolean),
    ),
  ];
}
