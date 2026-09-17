// Adding and editing a rule (06/09): the logic of `POST /api/rules`, `PATCH /api/rules/:id` and
// `DELETE /api/rules/:id`.
//
// Upsert and edit used to build the same patch twice, and the copies drifted (`summary` was
// trimmed in only one). `scopeFields` is now the only answer to "what does a rule body write".
//
// An upsert never updates the lock: re-dropping a .md file must not unlock a rule, which would
// open the hole the lock exists to close. Globs do update: they say when the rule applies, which
// the dropped file knows better, and a glob loosens nothing.
import { nanoid } from "nanoid";
import type * as schema from "../../drizzle/schema.js";
import { RULE_STATUS } from "./agent/agent-enums.js";
import { revokeGrantEverywhere } from "./grant-revoke.js";
import {
  deleteRuleRow,
  getRule,
  insertRule,
  repoNamesOfProject,
  rulesOf,
  updateRule,
} from "./rule-edit-store.js";
import type { RulePatch, RuleUpsert } from "./schemas.js";

type RuleRow = typeof schema.rules.$inferSelect;

export type RuleUpsertResult =
  | { ok: true; rule: RuleRow; created: boolean }
  | { ok: false; status: 400; error: string };

export type RuleEditResult = { ok: true } | { ok: false; status: 400 | 404; error: string };

/** Glob caps per rule (v60). Twenty covers any real rule and bounds expansion: Claude Code's
 *  braces multiply (`{a,b}/{c,d}/*.{ts,tsx}` makes eight patterns) and past a thousand expanded
 *  patterns it uses the pattern unexpanded, which then silently matches nothing. We stay far below
 *  rather than replicate its arithmetic. */
const MAX_GLOBS = 20;
const MAX_GLOB_LEN = 200;

type Scoped = { repoNames?: string[]; paths?: string[]; summary?: string; allAgents?: boolean };

/** A rule's repository scope, checked against the project's real repositories (v41): an unknown
 *  name makes a rule that never applies, silently. The bad name is returned, not dropped.
 *
 *  `undefined` = the field was not in the request, change nothing. An empty list is a distinct
 *  value: "this rule applies everywhere". */
function validateRepoScope(
  raw: string[] | undefined,
  projectId: string,
): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  const names = [...new Set(raw.map((n) => n.trim()).filter(Boolean))];
  const known = new Set(repoNamesOfProject(projectId));
  const unknown = names.filter((n) => !known.has(n));
  if (unknown.length)
    return { ok: false, error: `unknown repo(s) on this project: ${unknown.join(", ")}` };
  return { ok: true, value: names };
}

/** A rule's globs, validated for shape only (v60).
 *
 *  A glob need not match anything: the rule may target a repository not cloned yet or a folder a
 *  task will create. An unknown repository name is a typo; an unmatched glob is an intention.
 *
 *  Refused: an absolute path or `..`, both pointing outside the session workspace. */
function validateGlobs(
  raw: string[] | undefined,
): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  const globs = [...new Set(raw.map((g) => g.trim()).filter(Boolean))];
  if (globs.length > MAX_GLOBS)
    return {
      ok: false,
      error: `${MAX_GLOBS} patterns at most per rule (${globs.length} received)`,
    };
  const tooLong = globs.find((g) => g.length > MAX_GLOB_LEN);
  if (tooLong)
    return {
      ok: false,
      error: `pattern too long (${MAX_GLOB_LEN} characters at most): ${tooLong.slice(0, 60)}…`,
    };
  const escaping = globs.find((g) => g.startsWith("/") || g.split("/").includes(".."));
  if (escaping) return { ok: false, error: `pattern outside the session workspace: ${escaping}` };
  return { ok: true, value: globs };
}

/** Scope fields shared by upsert and edit, ready for a `set()`. A named error when a scope does
 *  not hold, else the partial patch (empty if the body did not mention scope). */
function scopeFields(
  input: Scoped,
  projectId: string,
): { ok: true; fields: Partial<RuleRow> } | { ok: false; error: string } {
  const scope = validateRepoScope(input.repoNames, projectId);
  if (!scope.ok) return scope;
  const globs = validateGlobs(input.paths);
  if (!globs.ok) return globs;
  return {
    ok: true,
    fields: {
      ...(input.allAgents !== undefined ? { allAgents: input.allAgents } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(scope.value !== undefined ? { repoNames: JSON.stringify(scope.value) } : {}),
      ...(globs.value !== undefined ? { paths: JSON.stringify(globs.value) } : {}),
    },
  };
}

/** A project's rules, or all of them. */
export function listRules(projectId: string | undefined): RuleRow[] {
  return rulesOf(projectId);
}

/** Upsert by (project, name), so re-dropping the same .md file updates the rule instead of
 *  creating a twin. */
export function upsertRule(input: RuleUpsert): RuleUpsertResult {
  const scope = scopeFields(input, input.projectId);
  if (!scope.ok) return { ok: false, status: 400, error: scope.error };

  const existing = rulesOf(input.projectId).find((r) => r.name === input.name);

  if (existing) {
    const fields = { ...scope.fields, content: input.content };
    updateRule(existing.id, fields);
    return { ok: true, rule: { ...existing, ...fields }, created: false };
  }

  // Status is written explicitly rather than left to the column default: this row is returned to
  // the client, which would otherwise have to guess it.
  const row: RuleRow = {
    id: nanoid(10),
    projectId: input.projectId,
    name: input.name,
    content: input.content,
    allAgents: input.allAgents ?? false,
    status: RULE_STATUS.active,
    summary: input.summary?.trim() ?? "",
    // Already serialised by `scopeFields`; absent from the body, a new rule gets the widest scope.
    repoNames: scope.fields.repoNames ?? "[]",
    locked: input.locked === true,
    paths: scope.fields.paths ?? "[]",
    createdAt: new Date(),
  };
  insertRule(row);
  return { ok: true, rule: row, created: true };
}

/** Edits an existing rule. Everything is optional, including the lock and the status, which are
 *  screen gestures rather than file content. */
export function editRule(ruleId: string, patch: RulePatch): RuleEditResult {
  const rule = getRule(ruleId);
  if (!rule) return { ok: false, status: 404, error: "rule not found" };

  const scope = scopeFields(patch, rule.projectId);
  if (!scope.ok) return { ok: false, status: 400, error: scope.error };

  updateRule(rule.id, {
    ...scope.fields,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.content !== undefined ? { content: patch.content.trim() } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
  });
  return { ok: true };
}

/** Clears the rule's grants, then deletes it: the row tells which project to sweep. */
export function deleteRule(ruleId: string): void {
  revokeGrantEverywhere("rule", ruleId);
  deleteRuleRow(ruleId);
}
