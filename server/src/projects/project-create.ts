// Creating a project: the project, its environment, its "main" repository and its default agent
// (06/09). Extracted from `POST /api/projects` so the repository URL guard sits visibly next to the
// one in `repo-edit.ts`.
import { nanoid } from "nanoid";
import { FORGE_KINDS, forgeOfUrl, isSshRepoUrl, type ForgeKind } from "../integrations/forge.js";
import { NETWORKING } from "../shared/enums.js";
import { validateGitAuthorEmail, validateGitAuthorName } from "./git-identity.js";
import {
  insertProjectWithDefaults,
  projectById,
  slugExists,
  type ProjectRow,
} from "./project-create-store.js";
import { assertRepoUrlAllowed } from "./repo-url.js";
import type { ProjectCreateInput } from "./schemas.js";

export type ProjectCreated =
  | { ok: true; project: ProjectRow }
  | { ok: false; status: 400 | 409; error: string };

const DEFAULT_ROLE_PROMPT =
  "You are the default agent of this project. Do the assigned task with the tools you have. Finish or report if stuck.";

/** The initial repository's forge, decided before creating anything: a half-created project would
 *  be worse than a refusal. `POST /api/repos` asks the same question; accepting here stored a row
 *  without a forge, read as "github", replaying the whole failure on the UI's most common path. */
function initialRepoForge(
  url: string,
): { ok: true; forge: ForgeKind | null } | { ok: false; error: string } {
  const forge = forgeOfUrl(url);
  if (!forge && !isSshRepoUrl(url))
    return {
      ok: false,
      error: `unknown forge for the host of ${url} — create the project without a repo, then add it under Project → Repos by picking its forge (${FORGE_KINDS.join(" or ")})`,
    };
  return { ok: true, forge };
}

type NewProjectFields = {
  name: string;
  fsRoot: string | null;
  authorName: string | null;
  authorEmail: string | null;
  slug: string;
};

type NewProjectValidation =
  | { ok: true; fields: NewProjectFields }
  | { ok: false; status: 400 | 409; error: string };

// Git identity (v19): refused here with a 400, never discovered in the container at the first
// `git commit`. See git-identity.ts for why a missing address is not a refusal.
function gitIdentityError(authorName: string | null, authorEmail: string | null): string | null {
  return (
    (authorName && validateGitAuthorName(authorName)) ||
    (authorEmail && validateGitAuthorEmail(authorEmail)) ||
    null
  );
}

/** Everything refusable before looking at the initial repository: name, files root, git identity,
 *  slug. */
function validateNewProject(input: ProjectCreateInput): NewProjectValidation {
  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, error: "name required" };
  const fsRoot = input.fsRoot?.trim() || null;
  if (fsRoot && !fsRoot.startsWith("/"))
    return { ok: false, status: 400, error: "fsRoot must be an absolute path" };
  const authorName = input.gitAuthorName?.trim() || null;
  const authorEmail = input.gitAuthorEmail?.trim() || null;
  const identityError = gitIdentityError(authorName, authorEmail);
  if (identityError) return { ok: false, status: 400, error: identityError };
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || nanoid(6);
  if (slugExists(slug)) return { ok: false, status: 409, error: `slug '${slug}' already exists` };
  return { ok: true, fields: { name, fsRoot, authorName, authorEmail, slug } };
}

type InitialRepo =
  | { ok: true; url: string | null; forge: ForgeKind | null }
  | { ok: false; error: string };

/** URL and forge of the "main" repository, or `null` when creation carries none. One place for both
 *  refusals: forbidden host, unknown forge. */
function resolveInitialRepo(repoUrl: string | undefined): InitialRepo {
  if (!repoUrl?.trim()) return { ok: true, url: null, forge: null };
  const checked = assertRepoUrlAllowed(repoUrl);
  if (!checked.ok) return { ok: false, error: checked.error };
  const decided = initialRepoForge(checked.url);
  if (!decided.ok) return { ok: false, error: decided.error };
  return { ok: true, url: checked.url, forge: decided.forge };
}

/** Four rows or none (05/09). Four bare INSERTs used to leave, when the default agent failed, a
 *  project without an agent that the rail showed like any other and from which no task could
 *  start. A database failure throws (500); a refusal is returned with its reason. */
export function createProject(input: ProjectCreateInput): ProjectCreated {
  const validated = validateNewProject(input);
  if (!validated.ok) return validated;
  const { name, fsRoot, authorName, authorEmail, slug } = validated.fields;

  const repo = resolveInitialRepo(input.repoUrl);
  if (!repo.ok) return { ok: false, status: 400, error: repo.error };

  const now = new Date();
  const projectId = nanoid(10);
  insertProjectWithDefaults({
    project: {
      id: projectId,
      name,
      slug,
      defaultModel: input.defaultModel ?? "sonnet",
      repoUrl: repo.url,
      fsRoot,
      gitAuthorName: authorName,
      gitAuthorEmail: authorEmail,
      createdAt: now,
    },
    environment: {
      id: nanoid(10),
      projectId,
      name: "open",
      networking: NETWORKING.open,
      allowedHosts: "[]",
    },
    // Multi-repos (v7): the creation repoUrl becomes the project's "main" repository. An SSH URL
    // enters with a NULL forge: cloning does not need it, review will ask for it via PATCH.
    repo: repo.url
      ? {
          id: nanoid(10),
          projectId,
          name: "main",
          url: repo.url,
          forge: repo.forge,
          createdAt: now,
        }
      : null,
    agent: {
      id: nanoid(10),
      projectId,
      name: "default",
      title: `Default agent · ${name}`,
      model: null,
      rolePrompt: DEFAULT_ROLE_PROMPT,
      fsGrants: JSON.stringify([
        { folderPath: "/agents/default", canRead: true, canWrite: true, canDelete: false },
      ]),
      createdAt: now,
    },
  });
  const project = projectById(projectId);
  // The transaction just inserted it: if it is missing, the database is lying. Say so loudly rather
  // than return an empty 201.
  if (!project) throw new Error(`project ${projectId} not found right after it was created`);
  return { ok: true, project };
}
