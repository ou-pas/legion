// A project's MCP server routes. The logic lives in `mcp-edit.ts`.
import type { Hono } from "hono";
import { parseBody } from "../http/parse-body.js";
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  setMcpServerAllAgents,
} from "./mcp-edit.js";
import { mcpServerBody, mcpServerPatchBody } from "./schemas.js";

export function registerMcpRoutes(app: Hono): void {
  app.get("/api/mcp-servers", (c) => c.json(listMcpServers(c.req.query("projectId"))));

  app.post("/api/mcp-servers", async (c) => {
    const parsed = await parseBody(c, mcpServerBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = createMcpServer(parsed.value);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.server, 201);
  });

  // v35: the "all agents" checkbox, as on a rule.
  app.patch("/api/mcp-servers/:id", async (c) => {
    const parsed = await parseBody(c, mcpServerPatchBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = setMcpServerAllAgents(c.req.param("id"), parsed.value.allAgents);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  app.delete("/api/mcp-servers/:id", (c) => {
    deleteMcpServer(c.req.param("id"));
    return c.json({ ok: true });
  });
}
