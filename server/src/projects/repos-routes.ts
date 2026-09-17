// A project's repositories: list them to pick from, connect, fix forge and test command, remove.
//
// Moved out of `projects/routes.ts` on 30/08. The rules left the handlers on 06/09 for
// `repo-edit.ts` and `repo-url.ts`, where the other doors a repository enters by (project creation,
// crate import) can use them too.
//
// A fact is fetched, a choice is asked (16/09). A repository URL and an account's verified address
// are facts the forge knows; making people type them was the defect. Hence two halves of one act:
// `GET /api/repos/available` lists what the project's connections reach, and `POST /api/repos` uses
// it to fill the git identity while it is still the default.
import type { Hono } from "hono";
import { db, schema } from "../shared/db.js";
import { discoverRepos, resolveForgeConnections } from "../integrations/forge-access.js";
import { effectiveForge, withForgeTimeout, type ForgeKind } from "../integrations/forge.js";
import { parseBody } from "../http/parse-body.js";
import { projectRowById, updateProjectRow } from "./project-edit-store.js";
import { identityToAdopt, isIdentityAtDefault } from "./repo-adoption.js";
import { createRepo, deleteRepo, editRepo } from "./repo-edit.js";
import { repoRowsOfProject } from "./repo-edit-store.js";
import { repoCreateBody, repoPatchBody } from "./schemas.js";

/** The git identity set by a repository arriving, or `null` if there was nothing to do.
 *
 *  It never fails the add: unreachable forge, token without scope, empty answer, wiring defect, the
 *  repository stays added and the identity unchanged. One `try` around everything, like
 *  `warnIfGitIdentityUnlinked`: what is not essential does not break what is.
 *
 *  The connection used is the one for the new repository's forge, else the first, so a project
 *  mixing two forges does not set the GitHub account's identity when adding a GitLab repository. */
async function adoptGitIdentity(
  projectId: string,
  forge: ForgeKind | null,
): Promise<{ name: string; email: string } | null> {
  try {
    const project = projectRowById(projectId);
    if (!project) return null;
    // Cheapest refusal first: a chosen identity is not touched, and knowing it costs no network call.
    if (!isIdentityAtDefault({ name: project.gitAuthorName, email: project.gitAuthorEmail }))
      return null;
    const connections = resolveForgeConnections(projectId);
    const on = connections.find((c) => c.kind === forge) ?? connections[0];
    if (!on) return null;
    // The timeout is mandatory: this call sits on a POST a human waits for behind a spinner, and
    // `undici` allows 300 s of `headersTimeout` by default. The repository row is already written; a
    // silent instance held the request five minutes for work already done.
    const [login, verifiedEmails] = await Promise.all([
      withForgeTimeout("reading the account", () => on.adapter.getTokenOwnerLogin(on.token)).catch(
        () => null,
      ),
      withForgeTimeout("reading the addresses", () =>
        on.adapter.listVerifiedEmails(on.token),
      ).catch(() => null),
    ]);
    const adopted = identityToAdopt({
      current: { name: project.gitAuthorName, email: project.gitAuthorEmail },
      login,
      // This port returns only a login; the display name has no path here, and the operator's
      // account has none anyway (`name: null`, checked on 15/09).
      name: null,
      verifiedEmails,
    });
    if (!adopted) return null;
    updateProjectRow(projectId, {
      gitAuthorName: adopted.name,
      gitAuthorEmail: adopted.email,
    });
    return adopted;
  } catch {
    return null;
  }
}

export function registerRepoRoutes(app: Hono): void {
  app.get("/api/repos", (c) => {
    const projectId = c.req.query("projectId");
    return c.json(
      db
        .select()
        .from(schema.repos)
        .all()
        .filter((r) => !projectId || r.projectId === projectId),
    );
  });

  /** What the project's connections reach: the list to pick from instead of typing a URL.
   *
   *  `connected: []` is an empty state with a way out, not an error: no provider is connected and
   *  the UI points to Integrations. A 4xx would read "broken" for "not done yet".
   *
   *  `declared` marks, by URL, what the project already has, so the UI shows it checked rather than
   *  letting the operator discover the duplicate as a 409. */
  app.get("/api/repos/available", async (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const { connected, repos, errors, truncated } = await discoverRepos(projectId);
    const declared = new Set(repoRowsOfProject(projectId).map((r) => r.url.toLowerCase()));
    // Truncation is returned as discovery judged it: the UI must say so rather than silently show
    // an incomplete list.
    return c.json({
      connected,
      repos: repos.map((r) => ({ ...r, declared: declared.has(r.url.toLowerCase()) })),
      truncated,
      errors,
    });
  });

  app.post("/api/repos", async (c) => {
    const body = await parseBody(c, repoCreateBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const created = createRepo(body.value);
    if (!created.ok) return c.json({ error: created.error }, created.status);
    const gitIdentityAdopted = await adoptGitIdentity(
      created.value.projectId,
      effectiveForge(created.value),
    );
    // The adopted identity comes back with the repository: a value appearing on another screen
    // unannounced is a surprise, not a service.
    return c.json({ ...created.value, gitIdentityAdopted }, 201);
  });

  app.patch("/api/repos/:id", async (c) => {
    const body = await parseBody(c, repoPatchBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const edited = editRepo(c.req.param("id"), body.value);
    if (!edited.ok) return c.json({ error: edited.error }, edited.status);
    return c.json({ ok: true });
  });

  // Removing an unknown repository answers `ok`: idempotent.
  app.delete("/api/repos/:id", (c) => {
    deleteRepo(c.req.param("id"));
    return c.json({ ok: true });
  });
}
