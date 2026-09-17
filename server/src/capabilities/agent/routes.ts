// Agent routes and the agent library: edit a card, promote to a template, instantiate a template
// in a project. Humble routes (06/09): validated body, service call, status mapping; the database
// belongs to `applyAgentEdit` and `chains/catalog.ts`.
import type { Hono } from "hono";
import { deleteLibraryEntry, installAgent, listAgentLibrary } from "../../chains/catalog.js";
import { catalogFail } from "../../chains/routes.js";
import { parseBody } from "../../http/parse-body.js";
import { applyAgentEdit } from "./edit.js";
import { promoteAgentToTemplate } from "./promote.js";
import { agentPatchBody, instantiateBody } from "../schemas.js";

export function registerAgentRoutes(app: Hono): void {
  app.patch("/api/agents/:id", async (c) => {
    const parsed = await parseBody(c, agentPatchBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = await applyAgentEdit(c.req.param("id"), parsed.value);
    if (!result.ok) return c.json({ error: result.error, live: result.live }, result.status);
    return c.json({ ok: true });
  });

  // A promotion that updates an existing template answers 200; one that creates it, 201.
  app.post("/api/agents/:id/promote", (c) => {
    const result = promoteAgentToTemplate(c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, result.status);
    if (result.updated) return c.json({ id: result.id, updated: true });
    return c.json({ id: result.id }, 201);
  });

  // The library is built-in (catalog.ts) plus operator-made (database). Each entry carries
  // `builtin` so the screen does not offer a delete that would answer 409.
  app.get("/api/agent-templates", (c) => c.json(listAgentLibrary()));

  app.delete("/api/agent-templates/:id", (c) => {
    try {
      deleteLibraryEntry("agent", c.req.param("id"));
      return c.json({ ok: true });
    } catch (e) {
      return catalogFail(c, e);
    }
  });

  // Grants stay per project (least privilege): the agent starts with its private folder only.
  app.post("/api/agent-templates/:id/instantiate", async (c) => {
    const parsed = await parseBody(c, instantiateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      return c.json(installAgent(c.req.param("id"), parsed.value.projectId), 201);
    } catch (e) {
      return catalogFail(c, e);
    }
  });
}
