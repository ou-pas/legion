// Capabilities routes: the tool catalogue and skills, plus registration of the agent, rule and
// MCP server routes, which have their own files. Bodies arrive validated (`schemas.ts`); logic
// lives in services (`agent/edit`, `rule-edit`, `mcp-edit`, `agent/promote`, `grant-revoke`).
// `registerCapabilityRoutes` is the only entry point `index.ts` knows.
import type { Hono } from "hono";
import { deleteSkill, listSkills, readSkill, saveSkill } from "./capabilities.js";
import { parseBody } from "../http/parse-body.js";
import {
  BASE_SDK_TOOLS,
  LEGION_MCP_TOOLS,
  DEFAULT_TOOLS,
  REQUIRED_INBOX_TOOLS,
  INBOX_GATED_TOOLS,
  WEB_TOOLS,
} from "./tool-grants.js";
import { registerAgentRoutes } from "./agent/routes.js";
import { registerMcpRoutes } from "./mcp-routes.js";
import { registerRuleRoutes } from "./rules-routes.js";
import { revokeGrantEverywhere } from "./grant-revoke.js";
import { skillUploadBody } from "./schemas.js";

export function registerCapabilityRoutes(app: Hono): void {
  // Tool catalogue (v32): the allowlist of tools an agent may use, so the web does not keep a
  // static mirror.
  app.get("/api/tool-catalog", (c) =>
    c.json({
      baseSdkTools: BASE_SDK_TOOLS,
      webTools: WEB_TOOLS,
      legionMcpTools: LEGION_MCP_TOOLS,
      defaultTools: DEFAULT_TOOLS,
      requiredInboxTools: REQUIRED_INBOX_TOOLS,
      inboxGatedTools: INBOX_GATED_TOOLS,
    }),
  );

  // Skills (phase 5b): a folder on disk, granted agent by agent.
  app.get("/api/skills", (c) => c.json(listSkills()));

  // Read a skill in the app: one does not grant an agent a folder one has never opened.
  app.get("/api/skills/:name", (c) => {
    try {
      return c.json(readSkill(c.req.param("name")));
    } catch (e) {
      return c.json({ error: String((e as Error).message) }, 404);
    }
  });

  // Upload from the UI dropzone (replaces an existing skill). `saveSkill` judges paths and sizes
  // and throws a named refusal, hence the `try` around it alone.
  app.post("/api/skills", async (c) => {
    const parsed = await parseBody(c, skillUploadBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      return c.json({ ok: true, ...saveSkill(parsed.value.name, parsed.value.files) }, 201);
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 400);
    }
  });

  app.delete("/api/skills/:name", (c) => {
    const name = c.req.param("name");
    try {
      deleteSkill(name);
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 400);
    }
    // No ghost grant: a deleted skill leaves the agents referencing it. Skills live on disk, so
    // the sweep has no project to stay within.
    revokeGrantEverywhere("skill", name);
    return c.json({ ok: true });
  });

  registerAgentRoutes(app);
  registerRuleRoutes(app);
  registerMcpRoutes(app);
}
