// A branch's name ("nav" work, slice 15).
//
// Our branches were called `legion/<nanoid>`: three violations of https://conventionalbranch.org at
// once. `legion` is not an allowed type, the nanoid is mixed case where only `a-z`, `0-9` and the
// dash are allowed, and there is no description. `legion/JUoRZqThA5` tells nothing to whoever opens
// a repository's branch list.
//
// This module is pure (no database, disk or clock), so its edge cases are testable one by one: an
// empty name, a fully non-alphanumeric name, accents, doubled dashes, a two-hundred-character name.
// When to set a branch is decided in `lifecycle.ts`; here we only format it.
//
// The key is not the nanoid. Its mixed case violates the spec, and simply lowercasing it would
// collide two tasks whose ids differ only by case (`aB` and `Ab`), so two tasks pushing to the same
// branch, one silently overwriting the other. A digest is injective where `toLowerCase()` is not.
import { createHash } from "node:crypto";

/** The three types this repository emits. The spec allows five (`hotfix`, `release` too): not
 *  offered, because a classifier choosing among five close labels errs more often, and no Legion
 *  gesture produces a release today. */
export const BRANCH_TYPE = {
  feature: "feature",
  bugfix: "bugfix",
  chore: "chore",
} as const;
export const BRANCH_TYPES = [BRANCH_TYPE.feature, BRANCH_TYPE.bugfix, BRANCH_TYPE.chore] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

/** The honest default, and the fallback for anything uncertain: a documentation fix sent as
 *  `feature/` lies more than an overcautious `chore/`. */
export const DEFAULT_BRANCH_TYPE: BranchType = BRANCH_TYPE.chore;

/** Enough to read the subject in a branch list, short enough for the line to fit next to the type
 *  and key. A task name goes up to 200 characters (`task-edit.ts`). */
const SLUG_MAX = 48;

/** Digest length. 8 hex characters = 4.3 billion values, for a control plane counting tasks in
 *  hundreds: the collision risk is far below that of the 10-character nanoid it stands for. */
const KEY_LEN = 8;

const VALID = new RegExp(`^(${BRANCH_TYPES.join("|")})/[a-z0-9]+(-[a-z0-9]+)*$`);

/** A task name is human-written: accents, capitals, punctuation, emoji. It cannot become a branch
 *  segment as is.
 *
 *  Returns the empty string when nothing is left, a normal case, not an error: "⚠️" or "???" have no
 *  letter to give. The caller then falls back to the key alone. */
export function branchSlug(name: string): string {
  return (
    name
      // Diacritics are removed by their escaped Unicode range, never pasted raw into the source: a
      // combining character is invisible when reviewing and gets lost on copy.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      // Re-cleaned after the cut, the module's trap: slicing at 48 characters can land right on a
      // dash, and a branch ending with a dash is refused by the spec.
      .replace(/-+$/, "")
  );
}

/** A run scope's stable key (`taskRunScope`): lowercase, alphanumeric, deterministic. Two distinct
 *  scopes give two distinct keys, including when they differ only by case, which `toLowerCase()`
 *  on the nanoid did not guarantee. */
export function branchKey(scope: string): string {
  return createHash("sha256").update(scope).digest("hex").slice(0, KEY_LEN);
}

/** `<type>/<slug>-<key>`, or `<type>/<key>` when the name gave nothing.
 *
 *  This function refuses nothing: an ugly branch beats one git refuses, and task creation must never
 *  fail on formatting its name. Conformity holds by construction, and `isConventionalBranch` lets
 *  the test check it rather than assume it. */
export function formatBranch(type: BranchType, name: string, scope: string): string {
  const slug = branchSlug(name);
  const key = branchKey(scope);
  return slug ? `${type}/${slug}-${key}` : `${type}/${key}`;
}

/** conventionalbranch.org's format restricted to our three types: a type, a slash, then `a-z0-9`
 *  groups separated by a single dash, so no doubled dash, no edge dash, no empty segment. */
export function isConventionalBranch(branch: string): boolean {
  return VALID.test(branch);
}

/** The type of a value from elsewhere (column, request body, model answer), or the default. An
 *  unknown type fails nobody: it falls back to `chore`. */
export function asBranchType(value: unknown): BranchType {
  return (BRANCH_TYPES as readonly unknown[]).includes(value)
    ? (value as BranchType)
    : DEFAULT_BRANCH_TYPE;
}

/** The commit type matching each branch type. conventionalbranch.org and conventionalcommits.org do
 *  not quite speak the same language: `feature` versus `feat`, `bugfix` versus `fix`. The three
 *  target values are in the commit spec's default set and in Acme's CI type list
 *  (`ytanikin/pr-conventional-commits`), which is what refused `AcmeHQ/frontend#526`. */
const COMMIT_TYPE: Record<BranchType, string> = { feature: "feat", bugfix: "fix", chore: "chore" };

/** The conventional commit type a branch carries, read from its first segment.
 *
 *  The branch is the source of truth, which is why we derive here rather than re-read `task.type`:
 *  a fix task pushes to the branch of the PR it fixes (`externalRef.branch`), unrelated to its own
 *  type. The title must match what is being pushed to.
 *
 *  An unknown first segment (old `legion/…` branches, `main`, another tool's PR branch) falls back
 *  to `chore` through `asBranchType`: the module's honest default. */
export function commitTypeOfBranch(branch: string): string {
  return COMMIT_TYPE[asBranchType(branch.split("/")[0])];
}
