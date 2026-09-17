// No rules here: they live in `environments.ts`. Routes only map a result to an HTTP status. The
// origin guard is the `mutationOriginGuard` middleware (http/guard.ts), not a per-route call.
import { Hono } from "hono";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";
import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  patchEnvironment,
} from "./environments.js";

/** `allowedHosts` stays opaque to the schema on purpose: `environments.ts` judges each host and
 *  names what is wrong ("no scheme and no path"). A `z.array(z.string())` here would return a type
 *  error instead of a sentence that reads on its own. */
const allowedHosts = z.unknown().optional();
const createEnvironmentBody = z.strictObject({
  projectId: z.string().optional(),
  name: z.string().optional(),
  allowedHosts,
});
const patchEnvironmentBody = z.strictObject({ name: z.string().optional(), allowedHosts });

export function registerEnvironmentRoutes(app: Hono): void {
  app.get("/api/environments", (c) =>
    c.json(listEnvironments(c.req.query("projectId") || undefined)),
  );

  app.post("/api/environments", async (c) => {
    const parsed = await parseBody(c, createEnvironmentBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const r = createEnvironment(parsed.value);
    return r.ok ? c.json(r.value, 201) : c.json({ error: r.error }, r.status);
  });

  app.patch("/api/environments/:id", async (c) => {
    const parsed = await parseBody(c, patchEnvironmentBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const r = patchEnvironment(c.req.param("id"), parsed.value);
    return r.ok ? c.json(r.value) : c.json({ error: r.error }, r.status);
  });

  app.delete("/api/environments/:id", (c) => {
    const r = deleteEnvironment(c.req.param("id"));
    // The 409 carries `agentNames` besides the sentence, so the UI can link to agents without
    // parsing text.
    return r.ok ? c.json(r.value) : c.json({ error: r.error, agentNames: r.agentNames }, r.status);
  });
}
