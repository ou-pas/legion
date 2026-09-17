import { Hono } from "hono";
import { listModels } from "../models/models.js";
import { probeModel } from "../models/models-probe.js";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";

// No origin check here: `mutationOriginGuard` (http/guard.ts) covers every POST outside
// `/internal` and `/webhooks`.
const probeModelBody = z.strictObject({
  id: z.string().trim().min(1),
  projectId: z.string().optional(),
});

export function registerModelRoutes(app: Hono): void {
  // `source: "fallback"` tells the screen to say so: a fallback list looks like the real one.
  app.get("/api/models", async (c) =>
    c.json(await listModels({ refresh: c.req.query("refresh") === "1" })),
  );

  // Informs, never forbids: an "unknown" verdict is not a 4xx, the screen may still save.
  app.post("/api/models/probe", async (c) => {
    const parsed = await parseBody(c, probeModelBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json(await probeModel(parsed.value.id, parsed.value.projectId));
  });
}
