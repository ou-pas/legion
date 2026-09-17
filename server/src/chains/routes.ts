import { Hono } from "hono";
import { runTask } from "../sessions/runner/manager.js";
import { instantiateTemplate } from "../chains/templates.js";
import {
  CatalogError,
  deleteLibraryEntry,
  installChain,
  listChainLibrary,
  promoteChain,
  uninstallChain,
} from "../chains/catalog.js";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";
import { fromResult } from "../http/from-result.js";
import { HttpError } from "../http/errors.js";

/** Two bodies, two lines: a `<domain>/schemas.ts` would only be one more file to open. */
const runTemplateBody = z.strictObject({ request: z.string().trim().min(1) });
const installChainBody = z.strictObject({ projectId: z.string().min(1) });

/** Unused here since 06/09: `app.onError` maps a `CatalogError` to its status for every route. It
 *  stays exported because `capabilities/agent/routes.ts` still uses it; it goes once that caller
 *  lets go. */
export function catalogFail(
  c: { json: (o: unknown, s: 400 | 404 | 409) => Response },
  e: unknown,
): Response {
  if (e instanceof CatalogError) return c.json({ error: e.message }, e.status);
  return c.json({ error: String((e as Error).message) }, 400);
}

export function registerChainRoutes(app: Hono): void {
  // A failed start keeps its message but answers 502, not 400. The chain exists when step 1 does
  // not start: the request was fine, a machine did not take the work. The message tells the
  // operator the chain is there and only the step needs rerunning.
  app.post("/api/templates/:id/run", async (c) => {
    const parsed = await parseBody(c, runTemplateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const created = instantiateTemplate(c.req.param("id"), parsed.value.request);
    if (!created.ok) return fromResult(c, created);
    const { runId, taskIds } = created.value;
    await runTask(taskIds[0]!, { mock: c.req.query("mock") === "1" ? true : undefined }).catch(
      (err) => {
        throw new HttpError(
          `chain created but step 1 failed to start: ${(err as Error).message}`,
          502,
        );
      },
    );
    return c.json({ runId, taskIds }, 201);
  });

  // Chain library (v18). A chain used to belong to one project (`task_templates.project_id` NOT
  // NULL): deleting the Demo project took "compound-engineer" with it. The library makes it
  // available everywhere, and installing copies it into the project, where the copy stays editable.
  app.get("/api/chain-templates", (c) => c.json(listChainLibrary()));

  app.delete("/api/chain-templates/:id", (c) => {
    deleteLibraryEntry("chain", c.req.param("id"));
    return c.json({ ok: true });
  });

  // Copy + missing step agents in one transaction. A step agent that resolves nowhere makes the
  // install refuse and name it, never a silent fallback to the default agent.
  app.post("/api/chain-templates/:id/install", async (c) => {
    const parsed = await parseBody(c, installChainBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json(installChain(c.req.param("id"), parsed.value.projectId), 201);
  });

  // Upsert by name, like an agent.
  app.post("/api/templates/:id/promote", (c) => {
    const res = promoteChain(c.req.param("id"));
    return res.updated ? c.json(res) : c.json(res, 201);
  });

  // Removes the project's copy; the library entry stays.
  app.delete("/api/templates/:id", (c) =>
    c.json({ ok: true, ...uninstallChain(c.req.param("id")) }),
  );
}
