// Inbound webhook routes: two public ones (the doorbell), three for the screen. In `review/`
// because they compose verification (integrations) and decision (merge-events), the same
// dependency direction as `open-pr.ts`.
//
// The public ones live outside `/api`, by decision (spec, decision 1): `/api/webhooks` already
// belongs to outgoing webhooks (notifications/routes.ts), the API contract only looks at `/api/`
// (a route with no UI caller would be declared a gap), and the public funnel only mounts the
// `/webhooks` prefix. Their gate is not the origin guard (exempted for this prefix in
// http/guard.ts; the prefix is reserved in http/static.ts so the screen fallback never serves the
// UI to the Internet) but the signature, verified here on the raw body.
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isNotNull } from "drizzle-orm";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";
import { db, schema } from "../shared/db.js";
import { setSetting } from "../shared/settings.js";
import {
  MAX_BODY_BYTES,
  PUBLIC_BASE_URL_KEY,
  connectRepoWebhook,
  hasInboundWebhookSecret,
  inboundWebhookSecret,
  parseGithubEvent,
  parseGitlabEvent,
  publicBaseUrl,
  verifyGithubSignature,
  verifyGitlabToken,
} from "../integrations/inbound-webhooks.js";
import { handleForgeEvent } from "./merge-events.js";

/** Volume guardrail behind the signature (security review). The signature bounds who speaks, not
 *  how much: a leaked secret, or a forge redelivering in a loop, could otherwise trigger unbounded
 *  forge re-reads and activity writes. A 429 can be redelivered exactly like the 503.
 *  ponytail: global fixed window in memory; per forge/repository if two legitimate forge instances
 *  ever saturate the same minute. */
const RATE_LIMIT_PER_MIN = 60;
let rateWindowStart = 0;
let rateSeen = 0;
function overRateLimit(now = Date.now()): boolean {
  if (now - rateWindowStart > 60_000) {
    rateWindowStart = now;
    rateSeen = 0;
  }
  return ++rateSeen > RATE_LIMIT_PER_MIN;
}

export function registerInboundWebhookRoutes(app: Hono): void {
  // The size cap is a middleware, not a check after reading (security review): a `chunked` body
  // without Content-Length was fully buffered by `c.req.text()` before any check, so a pre-auth
  // request could bring down the whole process, API and sessions included. `bodyLimit` reads as a
  // stream and cuts as soon as the total exceeds.
  app.post(
    "/webhooks/:forge",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "body too large" }, 413),
    }),
    async (c) => {
      const forge = c.req.param("forge");
      if (forge !== "github" && forge !== "gitlab") return c.json({ error: "unknown forge" }, 404);
      const raw = await c.req.text();

      // No secret exists until something was connected: refuse without minting one.
      if (!hasInboundWebhookSecret())
        return c.json({ error: "no webhook connected on this instance" }, 401);
      const secret = inboundWebhookSecret();
      const verified =
        forge === "github"
          ? verifyGithubSignature(raw, c.req.header("x-hub-signature-256"), secret)
          : verifyGitlabToken(c.req.header("x-gitlab-token"), secret);
      if (!verified) return c.json({ error: "invalid signature" }, 401);
      // After the signature (an anonymous caller does not spend the forges' budget), before any work.
      if (overRateLimit()) return c.json({ error: "too many events — redeliver in a minute" }, 429);

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json({ error: "unreadable JSON" }, 400);
      }
      const ev =
        forge === "github"
          ? parseGithubEvent(c.req.header("x-github-event"), body)
          : parseGitlabEvent(c.req.header("x-gitlab-event"), body);
      // An event we do not handle (open, push, ping, note…) gets a 200: the forge did nothing
      // wrong, and repeated 4xx would end up making it disable the hook.
      if (!ev) return c.json({ ok: true, ignored: true });

      const result = await handleForgeEvent(ev);
      // Nothing decided because the forge was unreadable: non-2xx, so the delivery is marked failed
      // and can be redelivered (GitLab retries on its own, GitHub keeps its Redeliver button). The
      // doorbell rings once; a merge lost silently would stay in review.
      if (result.unreadable && result.completed.length === 0)
        return c.json(
          { error: "unreadable forge, nothing was decided — redeliver this event" },
          503,
        );
      return c.json({ ok: true, matched: result.matched, completed: result.completed });
    },
  );

  // The screen (System settings, and the per-repository button).

  app.get("/api/inbound-webhooks", (c) => {
    const connected = db
      .select({ id: schema.repos.id })
      .from(schema.repos)
      .where(isNotNull(schema.repos.webhookId))
      .all().length;
    return c.json({
      baseUrl: publicBaseUrl(),
      // The secret's state, never its value: the server presents it to the forges.
      secretReady: hasInboundWebhookSecret(),
      connectedRepos: connected,
    });
  });

  // This route's body goes through a schema (06/09); `/webhooks/:forge`'s does not, deliberately:
  // it is read as raw text because the signature covers the exact bytes, and
  // `parseGithubEvent` / `parseGitlabEvent` judge it afterwards.
  app.patch("/api/inbound-webhooks", async (c) => {
    const parsed = await parseBody(c, z.strictObject({ baseUrl: z.string() }));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const trimmed = parsed.value.baseUrl.trim().replace(/\/+$/, "");
    // https required: the forge will post a header secret there, and a cleartext webhook would
    // broadcast it. Empty = clear the setting, a legitimate gesture.
    if (trimmed && !/^https:\/\/[^\s/]+/.test(trimmed))
      return c.json(
        { error: "invalid public URL: https://… expected (the funnel host, without a path)" },
        400,
      );
    setSetting(PUBLIC_BASE_URL_KEY, trimmed);
    return c.json({ ok: true, baseUrl: publicBaseUrl() });
  });

  app.post("/api/repos/:id/webhook", async (c) => {
    const result = await connectRepoWebhook(c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result);
  });
}
