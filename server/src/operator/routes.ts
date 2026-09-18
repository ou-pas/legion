// Operator session routes, plus the first-run setup status. All four are exempt from
// `operatorGuard`, in one place, and its test checks the exemption is exactly these paths and
// nothing more.
import { z } from "zod";
import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { parseBody } from "../http/parse-body.js";
import { OPERATOR_COOKIE, closeSession, openSession, tokenMatches } from "./operator.js";
import { allOperatorSessions, operatorSessionRow } from "./operator-store.js";

const loginBody = z.object({ token: z.string().min(1) });

/** `secure` only when the request already arrived over HTTPS. Hard-coding it would break login
 *  today, where the control plane speaks plain HTTP on the tailnet: the browser would not send the
 *  cookie and the screen would loop silently. It turns on by itself once Caddy fronts it. */
function isHttps(c: { req: { url: string; header: (n: string) => string | undefined } }): boolean {
  if (c.req.header("x-forwarded-proto") === "https") return true;
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function registerOperatorRoutes(app: Hono): void {
  // Always 200, even to a stranger: the gate asks this before any session exists, to tell a fresh
  // install from a returning operator who forgot the token. Only a boolean, never the token itself.
  app.get("/api/operator/setup", (c) => {
    return c.json({ required: allOperatorSessions().length === 0 });
  });

  // Always 200, even to a stranger: the UI asks this on load to decide whether to show login, and
  // a 401 would be a failure to display rather than an answer to read.
  app.get("/api/operator/session", (c) => {
    const row = operatorSessionRow(getCookie(c, OPERATOR_COOKIE) ?? "");
    return c.json(
      row ? { authenticated: true, method: row.method } : { authenticated: false, method: null },
    );
  });

  app.post("/api/operator/session", async (c) => {
    const body = await parseBody(c, loginBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    // The refusal says no more than "no": telling "no token exists" from "wrong token" would teach
    // a stranger the state of the instance.
    if (!tokenMatches(body.value.token)) return c.json({ error: "token refused" }, 401);
    const id = openSession("token");
    setCookie(c, OPERATOR_COOKIE, id, {
      httpOnly: true, // page JS cannot read it, so an XSS cannot exfiltrate it
      sameSite: "Lax", // second line behind `mutationOriginGuard`
      path: "/",
      secure: isHttps(c),
      maxAge: 60 * 60 * 24 * 365,
    });
    return c.json({ authenticated: true, method: "token" }, 201);
  });

  app.delete("/api/operator/session", (c) => {
    const id = getCookie(c, OPERATOR_COOKIE);
    if (id) closeSession(id);
    deleteCookie(c, OPERATOR_COOKIE, { path: "/" });
    return c.body(null, 204);
  });
}
