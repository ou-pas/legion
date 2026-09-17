// Rule routes: a project's standing instructions (5b), dropped as .md or written on screen, then
// injected into the prompt of the sessions they concern. The logic lives in `rule-edit.ts`.
import type { Hono } from "hono";
import { parseBody } from "../http/parse-body.js";
import { deleteRule, editRule, listRules, upsertRule } from "./rule-edit.js";
import { rulePatchBody, ruleUpsertBody } from "./schemas.js";

export function registerRuleRoutes(app: Hono): void {
  app.get("/api/rules", (c) => c.json(listRules(c.req.query("projectId"))));

  // Upsert by (project, name). 201 when new, 200 otherwise, so the screen tells "added" from
  // "updated" without rereading the list.
  app.post("/api/rules", async (c) => {
    const parsed = await parseBody(c, ruleUpsertBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = upsertRule(parsed.value);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    if (result.created) return c.json(result.rule, 201);
    return c.json({ ...result.rule, updated: true });
  });

  app.patch("/api/rules/:id", async (c) => {
    const parsed = await parseBody(c, rulePatchBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const result = editRule(c.req.param("id"), parsed.value);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  app.delete("/api/rules/:id", (c) => {
    deleteRule(c.req.param("id"));
    return c.json({ ok: true });
  });
}
