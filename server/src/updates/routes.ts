import { Hono } from "hono";
import { startUpdate, versionState } from "./updates.js";

export function registerUpdateRoutes(app: Hono): void {
  // Read-only: no git `fetch`, no write to `.git`. It runs on a screen timer, and a timer that
  // writes would eventually collide with a `git` typed by hand in a terminal.
  app.get("/api/version", async (c) => {
    try {
      return c.json(await versionState());
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 500);
    }
  });

  // Returns immediately: the detached script outlives this process, which dies once the checkout
  // touches `server/src`. The response carries the log path, the only witness of what follows.
  app.post("/api/version/update", async (c) => {
    try {
      // `suspendSessions` (08/09): opt-in graceful update. A missing body means `false`: the
      // default still refuses while sessions run; the screen's second button asks for the other.
      const body = (await c.req.json().catch(() => ({}))) as { suspendSessions?: unknown };
      return c.json(await startUpdate({ suspendSessions: body.suspendSessions === true }), 202);
    } catch (e) {
      return c.json({ error: String((e as Error).message ?? e) }, 409);
    }
  });
}
