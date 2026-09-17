// Which page may drive the human API, and nothing else: CSRF protection. It stops any web page
// from driving the API with the rights of the browser that opens it; the operator session does
// not answer that, since a cookie is sent on its own.
//
// Authorisation is the operator session (`operator/operator-guard.ts`). An address-based guard
// lived here until 13/09 and was removed: once remote runners made addresses indistinguishable, it
// refused nothing the session did not, and cost a 403 masking the real 401. Limiting who can reach
// the port is the job of the firewall or Tailscale ACLs, not Node: the socket must stay open on all
// interfaces so containers can call `/internal`.
import type { Context, Next } from "hono";

/** Same origin (since 13/09, replacing a list of allowed networks that would have refused the app
 *  served under its own domain behind a reverse proxy).
 *
 *  Comparing `Origin` with the request's `Host` holds in all three setups without configuration:
 *  `localhost:5173` in development (with `changeOrigin: false` in vite.config.ts), the control plane's tailnet
 *  address, its domain name behind a proxy.
 *
 *  The host is compared, not the scheme: `Host` carries no scheme, and requiring https would mean
 *  trusting `X-Forwarded-Proto`, a header the caller sets. */
export function allowedOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return u.host === host;
  } catch {
    return false;
  }
}

/** CORS does not block "simple requests" (POST text/plain, no preflight), hence an explicit Origin
 *  check. No Origin means curl or a local tool, so accepted: a hostile page cannot omit it. */
export function crossOriginBlocked(c: {
  req: { header: (n: string) => string | undefined };
}): boolean {
  const origin = c.req.header("origin");
  return Boolean(origin && !allowedOrigin(origin, c.req.header("host")));
}

/** Container paths carry a session token checked per route (`authSession`,
 *  sessions/internal-routes.ts). */
const CONTAINER_PREFIX = "/internal/";

/** Incoming forge webhooks (03/09) carry a proof checked per route: HMAC signature (GitHub) or
 *  header token (GitLab), on a secret only this instance knows. A forge sends no `Origin`. */
const WEBHOOK_PREFIX = "/webhooks/";

/** The guard once covered only `POST`, letting `PATCH` and `DELETE` through although they change an
 *  agent, a repo, a secret or delete a project. */
const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

/** Every mutation outside `/internal/*` (token) and `/webhooks/*` (signature) goes through it.
 *  Exported (06/09) so route tests mount it as `app.ts` does. */
export async function mutationOriginGuard(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  if (
    MUTATING.includes(c.req.method) &&
    !path.startsWith(CONTAINER_PREFIX) &&
    !path.startsWith(WEBHOOK_PREFIX) &&
    crossOriginBlocked(c)
  )
    return c.json({ error: "origin not allowed" }, 403);
  return next();
}
