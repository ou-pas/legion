// Routes of the projects domain: projects, agents, git identity, repositories, secrets.
//
// Thin since 06/09 (audit wave 2): read the body, call the service, map its verdict to a status.
// Rules live next door (`project-create`, `project-edit`, `purge`), and bodies go through
// `schemas.ts`, since `c.req.json<T>()` checked nothing. The origin guard is not repeated here: the
// `http/app.ts` middleware covers every mutation outside `/internal` and `/webhooks`.
import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../shared/db.js";

import { checkProjectGitIdentity } from "./git-identity-check.js";
import { projectPurgePreview, purgeProject } from "./purge.js";
import { registerRepoRoutes } from "./repos-routes.js";
import { registerCredentialRoutes } from "./credentials/routes.js";
import { registerSecretRoutes } from "./secrets-routes.js";
import { CatalogError, createAgent } from "../chains/catalog.js";
import { ensureDemoProject } from "./demo.js";
import { fromResult } from "../http/from-result.js";
import { parseBody } from "../http/parse-body.js";
import { createProject } from "./project-create.js";
import { editProject } from "./project-edit.js";
import { agentCreateBody, projectCreateBody, projectPatchBody } from "./schemas.js";
// A project's session image lives in `infra/` (it speaks docker and runners); this route attaches it
// to the project rather than opening a separate screen: `SessionRuntimeCard` (web/src/projects/)
// shows it next to the field declaring the tag.
import { projectImageOverview } from "../infra/images/project.js";
import {
  projectImageRebuildRunning,
  startProjectImageRebuild,
} from "../infra/images/project-rebuild.js";

const projectImageRebuildBody = z.strictObject({ runnerId: z.string().min(1) });

export function registerProjectRoutes(app: Hono): void {
  // Secrets, credentials and repositories carry their own routes, composed here rather than in
  // `index.ts`: they belong to the `projects` context.
  registerSecretRoutes(app);
  registerCredentialRoutes(app);
  registerRepoRoutes(app);

  // The side door of the no-project screen (nav, behaviour 8): look before connecting a repository.
  // Idempotent: opening the demo twice returns the same project.
  app.post("/api/projects/demo", (c) => {
    const { id, created } = ensureDemoProject();
    return c.json({ id, created }, created ? 201 : 200);
  });

  app.post("/api/projects", async (c) => {
    const body = await parseBody(c, projectCreateBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const created = createProject(body.value);
    if (!created.ok) return c.json({ error: created.error }, created.status);
    return c.json(created.project, 201);
  });

  // Create an agent from scratch in a project (04/09). Fine grants (repositories, rules, secrets,
  // MCP, browser) are then set through `PATCH /api/agents/:id`, as for an agent installed from the
  // library: one way to configure an agent.
  app.post("/api/projects/:id/agents", async (c) => {
    const body = await parseBody(c, agentCreateBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    try {
      const { id } = createAgent(c.req.param("id"), body.value);
      return c.json(db.select().from(schema.agents).where(eq(schema.agents.id, id)).get(), 201);
    } catch (e) {
      if (e instanceof CatalogError)
        return c.json({ error: e.message }, e.status as 400 | 404 | 409);
      throw e;
    }
  });

  // Will the forge attribute this project's git identity? A separate route rather than a project
  // field: the answer needs a network call, which has no place in loading a screen that must render
  // without a token. See git-identity-check.ts.
  app.get("/api/projects/:id/git-identity-check", async (c) => {
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, c.req.param("id")))
      .get();
    if (!project) return c.json({ error: "project not found" }, 404);
    return c.json(await checkProjectGitIdentity(project));
  });

  // What deleting the project would destroy, shown before confirming.
  app.get("/api/projects/:id/footprint", (c) => {
    const preview = projectPurgePreview(c.req.param("id"));
    if (!preview) return c.json({ error: "project not found" }, 404);
    return c.json(preview);
  });

  app.delete("/api/projects/:id", (c) => {
    const purged = purgeProject(c.req.param("id"));
    if (purged.ok)
      return c.json({ ok: true, deleted: purged.deleted, footprint: purged.footprint });
    if (purged.status === 409) return c.json({ error: purged.error, live: purged.live }, 409);
    return c.json({ error: purged.error }, purged.status);
  });

  app.patch("/api/projects/:id", async (c) => {
    const body = await parseBody(c, projectPatchBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const edited = editProject(c.req.param("id"), body.value);
    if (!edited.ok) return c.json({ error: edited.error }, edited.status);
    return c.json(edited.renamed ? { ok: true, ...edited.renamed } : { ok: true });
  });

  // The image this project actually uses on each runner (09/09, Kopee.me outage that day).
  // `sessionImageState` only inspected the default tag, never the one a project declares, which is
  // what launch uses (`spec.image ?? IMAGE`). `null` when the project declares no tag of its own.
  app.get("/api/projects/:id/session-image", async (c) => {
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, c.req.param("id")))
      .get();
    if (!project) return c.json({ error: "project not found" }, 404);
    return c.json({
      runners: await projectImageOverview(project, { rebuilding: projectImageRebuildRunning }),
    });
  });

  // The action next to the observation, like "rebuild here" on the Infra card (07/09): validate the
  // project's pasted Dockerfile and build it on the target host (nothing to clone since v67). Returns
  // at once; the result shows on the next `GET /api/projects/:id/session-image` or in the log.
  app.post("/api/projects/:id/session-image/rebuild", async (c) => {
    const body = await parseBody(c, projectImageRebuildBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    return fromResult(
      c,
      await startProjectImageRebuild(c.req.param("id"), body.value.runnerId),
      202,
    );
  });
}
