// The human API guard (13/09): it decides who may act, now that the caller's address cannot.
//
// It asks for a session, not a token. The token is one way to obtain a session, a security key
// will be another, and neither has to pass through here. See `operator.ts` for the reasoning.
//
// What it leaves alone, each for its own reason:
//   · `/internal/*`: the container channel, authenticated route by route with the token of their
//     own session (`authSession`).
//   · `/webhooks/*`: HMAC signature or header token, checked route by route. A forge cannot
//     present an operator session, and must not be able to.
//   · `/api/operator/session`: the door itself. A door you must pass to reach it never opens.
//   · anything outside `/api/`: the built UI and its files. The app must load without a session,
//     since it carries the login screen; what it serves is client code, nothing secret.
//
// It runs after CORS and `mutationOriginGuard` (`http/app.ts`). Those answer which page may drive
// the API; this one answers who may act. The address guard that used to limit who can reach the
// port was removed on 13/09 (see `http/guard.ts`); that job belongs to the firewall now.
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { OPERATOR_COOKIE, sessionIsOpen, tokenMatches } from "./operator.js";

const HUMAN_PREFIX = "/api/";
const LOGIN_PATH = "/api/operator/session";

/** The bearer of an `Authorization: Bearer …` header. This is the path for tools (`curl`,
 *  `make responsive`, measurement scripts) that cannot hold a cookie and have no reason to open a
 *  session they would then have to close. */
function bearer(c: Context): string | undefined {
  const raw = c.req.header("authorization");
  if (!raw?.startsWith("Bearer ")) return undefined;
  return raw.slice("Bearer ".length).trim() || undefined;
}

export async function operatorGuard(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  if (!path.startsWith(HUMAN_PREFIX) || path === LOGIN_PATH) return next();
  if (sessionIsOpen(getCookie(c, OPERATOR_COOKIE))) return next();
  if (tokenMatches(bearer(c))) return next();
  // The refusal names what it expects: otherwise a tool receiving 401 is left guessing between an
  // expired cookie, a wrong token and an unknown route. It says nothing about the instance's state
  // (whether a token exists, how many sessions are open).
  return c.json(
    {
      error:
        "an operator session is required. A browser opens one by pasting the token; " +
        "a tool presents `Authorization: Bearer <token>`. " +
        "The token is printed once, at the boot that creates it.",
    },
    401,
  );
}
