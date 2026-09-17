// A project's repositories, the domain side (06/09, audit wave 2): connect, fix, remove. Extracted
// from `repos-routes.ts`, whose handlers held the rules and could only be tested by mounting a Hono
// app. The URL checks are shared with the other doors a repository enters by (project creation,
// crate import) through `repo-url.ts`.
import { nanoid } from "nanoid";
import { forgeOfUrl, isSshRepoUrl, FORGE_KINDS } from "../integrations/forge.js";
import {
  agentRowsOfProject,
  deleteRepoRow,
  insertRepoRow,
  projectExists,
  repoRowById,
  repoRowsOfProject,
  updateAgentRepoNames,
  updateRepoRow,
  withTransaction,
  type RepoRow,
} from "./repo-edit-store.js";
import { assertRepoUrlAllowed } from "./repo-url.js";
import type { RepoCreateInput, RepoPatchInput } from "./schemas.js";

export type RepoResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 409; error: string };

const NAME_RE = /^[\w][\w.-]*$/;

/** Connects a repository or refuses, naming what is wrong. Check order is message order: missing,
 *  unnameable, unacceptable URL, already existing, then forge. */
export function createRepo(input: RepoCreateInput): RepoResult<RepoRow> {
  if (!input.projectId || !input.name.trim() || !input.url.trim())
    return { ok: false, status: 400, error: "projectId, name, url required" };
  // Does the project exist? Unchecked before 30/08: a `repos` row could point at an imaginary project,
  // invisible in every list yet read by queries filtering on `projectId`. An unenforced foreign key
  // is not one.
  if (!projectExists(input.projectId))
    return { ok: false, status: 404, error: "project not found" };
  const name = input.name.trim();
  if (!NAME_RE.test(name))
    return { ok: false, status: 400, error: "invalid name (letters, digits, ., -, _)" };
  const checked = assertRepoUrlAllowed(input.url);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const url = checked.url;
  if (repoRowsOfProject(input.projectId).some((r) => r.name.toLowerCase() === name.toLowerCase()))
    return { ok: false, status: 409, error: `a repo “${name}” already exists in this project` };
  const forge = input.forge ?? forgeOfUrl(url);
  // Over https the forge is required: it decides which credential the clone presents. Guessing
  // "github" would present the wrong one, and the failure would come at clone time in the container,
  // blaming an ungranted secret. Over SSH the key covers clone and push without a forge; it stays
  // declarable (or fixable via PATCH) for change requests.
  if (!forge && !isSshRepoUrl(url))
    return {
      ok: false,
      status: 400,
      error: `unknown forge for the host of ${url} — set “forge” (${FORGE_KINDS.join(" or ")})`,
    };
  const row = {
    id: nanoid(10),
    projectId: input.projectId,
    name,
    url,
    forge: forge ?? null,
    createdAt: new Date(),
  };
  insertRepoRow(row);
  return { ok: true, value: row as RepoRow };
}

/** v11: per-repository test command (run by the agent before pr.md). v29: the forge, fixable
 *  afterwards, since a self-hosted instance cannot be guessed. One UPDATE: the fields used to be two
 *  writes at two moments.
 *
 *  13/09: name and URL. A moved repository had to be removed and reconnected, which goes through
 *  `deleteRepo` and erases every agent grant citing it; the failure then came much later, in a
 *  container, on a clone no agent was allowed to do. Renaming here propagates instead of erasing, in
 *  the same transaction: the grant follows its repository.
 *
 *  Check order is message order, as at creation. */
export function editRepo(repoId: string, input: RepoPatchInput): RepoResult<null> {
  const repo = repoRowById(repoId);
  if (!repo) return { ok: false, status: 404, error: "repo not found" };
  const moved = movePatch(repo, input);
  if (!moved.ok) return moved;
  const patch: Partial<Pick<RepoRow, "forge" | "testCommand" | "name" | "url">> = {
    ...moved.value,
  };

  if (input.name !== undefined) {
    const named = checkedName(repo, input.name);
    if (!named.ok) return named;
    patch.name = named.value;
  }
  if (input.testCommand !== undefined) patch.testCommand = input.testCommand?.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true, value: null };

  const renamedTo = patch.name && patch.name !== repo.name ? patch.name : null;
  withTransaction(() => {
    if (renamedTo) rewriteRepoGrants(repo.projectId, repo.name, renamedTo);
    updateRepoRow(repo.id, patch);
  });
  return { ok: true, value: null };
}

/** URL and forge a patch asks for, or the refusal. Decided together: the forge picks the credential
 *  presented to the clone, and the URL host provides it when the caller is silent. */
function movePatch(
  repo: RepoRow,
  input: RepoPatchInput,
): RepoResult<Partial<Pick<RepoRow, "url" | "forge">>> {
  const patch: Partial<Pick<RepoRow, "url" | "forge">> = {};
  if (input.url !== undefined) {
    const checked = assertRepoUrlAllowed(input.url);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    patch.url = checked.url;
    // The forge follows the URL when the caller omits it, or a repository moved from GitHub to
    // GitLab would keep the old credential and fail only at clone.
    if (input.forge === undefined) patch.forge = forgeOfUrl(checked.url) ?? repo.forge;
  }
  if (input.forge !== undefined) patch.forge = input.forge;
  // Only for a patch touching one of the two: rows older than v29 carry `forge: null` over https
  // (implicit github), and refusing them would forbid fixing a working repository's test command.
  if (patch.url === undefined && patch.forge === undefined) return { ok: true, value: patch };
  const url = patch.url ?? repo.url;
  if (!(patch.forge ?? repo.forge) && !isSshRepoUrl(url))
    return {
      ok: false,
      status: 400,
      error: `unknown forge for the host of ${url} — set “forge” (${FORGE_KINDS.join(" or ")})`,
    };
  return { ok: true, value: patch };
}

/** The requested name, if it can be a clone folder and no sibling already has it. Renaming to its
 *  own name is a no-op, not a refusal. */
function checkedName(repo: RepoRow, requested: string): RepoResult<string> {
  const name = requested.trim();
  if (!NAME_RE.test(name))
    return { ok: false, status: 400, error: "invalid name (letters, digits, ., -, _)" };
  const taken = repoRowsOfProject(repo.projectId).some(
    (r) => r.id !== repo.id && r.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken)
    return { ok: false, status: 409, error: `a repo “${name}” already exists in this project` };
  return { ok: true, value: name };
}

/** A repository's name in the project's agent grants. `to = null` removes it (the repository is
 *  gone; a grant to nothing would be a ghost access); a name replaces it (same repository). */
function rewriteRepoGrants(projectId: string, from: string, to: string | null): void {
  for (const a of agentRowsOfProject(projectId)) {
    const names = JSON.parse(a.repoNames) as string[];
    if (!names.includes(from)) continue;
    const next = to ? names.map((x) => (x === from ? to : x)) : names.filter((x) => x !== from);
    updateAgentRepoNames(a.id, JSON.stringify(next));
  }
}

/** Removing an unknown repository is not an error: idempotent. What matters is cleaning grants, or
 *  an agent citing a vanished repository would keep a ghost access nothing displays. */
export function deleteRepo(repoId: string): void {
  const repo = repoRowById(repoId);
  if (!repo) return;
  withTransaction(() => {
    rewriteRepoGrants(repo.projectId, repo.name, null);
    deleteRepoRow(repoId);
  });
}
