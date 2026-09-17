import { Hono } from "hono";
import { z } from "zod";
import { listControlEvents } from "../shared/db.js";
import { parseBody } from "../http/parse-body.js";
import { fromResult } from "../http/from-result.js";
import { cleanupOrphans, infraOverview } from "../infra/infra.js";
import { IMAGE_TARGET_KEYS, startImageRebuild } from "./images/rebuild.js";
import { declareRunner } from "./runner/declare.js";
import { listRunners } from "./runner-list.js";
import { setRunnerConcurrency, setRunnerResources } from "./runner/limits.js";
import { deleteRunner, setRunnerEnabled } from "./runner/lifecycle.js";

/** Host, callback URL and cap stay OPAQUE to the schema: `runner/declare.ts` and `runner/limits.ts`
 *  normalise them and refuse by name. The schema CLOSES the key set, so an invented key no longer
 *  passes silently. */
const opaque = z.unknown().optional();
const declareRunnerBody = z.strictObject({
  name: opaque,
  dockerHost: opaque,
  callbackUrl: opaque,
  maxConcurrentSessions: opaque,
});
const rebuildImageBody = z.strictObject({
  targets: z
    .array(z.enum(IMAGE_TARGET_KEYS as [string, ...string[]]))
    .min(1)
    .optional(),
});
const patchRunnerBody = z.strictObject({
  maxConcurrentSessions: opaque,
  memoryMb: opaque,
  cpus: opaque,
  enabled: z.boolean().optional(),
});

export function registerInfraRoutes(app: Hono): void {
  // No `catch` here (06/09): `app.onError` returns "internal error" with a reference and logs the
  // detail (errors.ts), instead of leaking the raw message under a bare 500.
  app.get("/api/infra", async (c) => c.json(await infraOverview()));

  app.post("/api/infra/:runnerId/cleanup", async (c) =>
    // Destructive: covered by `mutationOriginGuard` (http/guard.ts) and the operator guard. Refusals
    // carry their status (404 runner, 502 daemon), see `cleanupOrphans`.
    fromResult(c, await cleanupOrphans(c.req.param("runnerId"))),
  );

  // Rebuild an image ON THIS machine (07/09), for the runner that slept through the update. No body
  // means the session image, which changes almost every tag.
  app.post("/api/infra/:runnerId/rebuild-image", async (c) => {
    const parsed = await parseBody(c, rebuildImageBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const targets = (parsed.value.targets ?? ["session"]) as (typeof IMAGE_TARGET_KEYS)[number][];
    return fromResult(c, await startImageRebuild(c.req.param("runnerId"), targets), 202);
  });

  // The fleet as a list (v66), without docker: what a task screen needs to pick a machine.
  // `/api/infra` would probe the whole fleet for three fields.
  app.get("/api/runners", (c) => c.json(listRunners()));

  // Declare a machine (01/09). The response carries the immediate probe verdict: a mistyped
  // `ssh://` host shows at once, not at the first session.
  app.post("/api/runners", async (c) => {
    const parsed = await parseBody(c, declareRunnerBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return fromResult(c, await declareRunner(parsed.value), 201);
  });

  // Runner settings (26/08: cap, then resources and enabled).
  app.patch("/api/runners/:id", async (c) => {
    const parsed = await parseBody(c, patchRunnerBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const body = parsed.value;
    const id = c.req.param("id");
    // Four settings, one route; each can be sent alone. Refusals carry their own status (the old
    // `catch` sniffed the message to pick 404 or 400).
    let out: unknown = null;
    if (body.memoryMb !== undefined || body.cpus !== undefined) {
      const resources = setRunnerResources(id, { memoryMb: body.memoryMb, cpus: body.cpus });
      if (!resources.ok) return fromResult(c, resources);
      out = resources.value;
    }
    if (body.maxConcurrentSessions !== undefined) {
      const concurrency = setRunnerConcurrency(id, body.maxConcurrentSessions);
      if (!concurrency.ok) return fromResult(c, concurrency);
      out = concurrency.value;
    }
    if (body.enabled !== undefined) {
      // The only field touching docker (cleanup on disable); its refusal lists the live sessions.
      const result = await setRunnerEnabled(id, body.enabled);
      if (!result.ok) return c.json({ error: result.error, live: result.live }, result.status);
      out = result;
    }
    if (!out) return c.json({ error: "nothing to change" }, 400);
    return c.json(out);
  });

  // Delete a mistakenly declared machine (04/09): undoes a declaration, never erases history (see
  // `runner/lifecycle.ts`). Cleans the runner's containers/networks/volumes first.
  app.delete("/api/runners/:id", async (c) => {
    const result = await deleteRunner(c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error, live: result.live }, result.status);
    return c.json(result);
  });

  // Control plane log (v20), read-only: only server-side `logControlEvent` writes. `limit` is capped
  // at 1000 by `listControlEvents`.
  app.get("/api/control-events", (c) => {
    const level = c.req.query("level");
    if (level && !["info", "warn", "error"].includes(level))
      return c.json({ error: "invalid level (info | warn | error)" }, 400);
    const limit = Number(c.req.query("limit") ?? 200);
    return c.json(
      listControlEvents({
        level: level as "info" | "warn" | "error" | undefined,
        limit: Number.isFinite(limit) ? limit : 200,
      }),
    );
  });
}
