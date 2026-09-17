// The built screen, served by the same process as the API (multi-machine work, 01/09): one port,
// one origin, no CORS, openable from any tailnet machine.
//
// Static serving is optional. Without `web/dist` (everyday development, the screen lives on Vite
// at :5173 which proxies `/api` here) nothing is mounted and `/` returns the service card. The
// folder decides, not a setting to keep consistent with it.
//
// Order is the fragile part: `registerStaticRoutes` is called LAST in `index.ts`. Hono runs handlers
// in registration order, and that alone guarantees a served route wins over a same-path file.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** Resolved from this file, not the cwd: the server usually runs from `server/`, but a
 *  `node src/index.ts` from the repo root must still find the screen. */
const DIST = fileURLToPath(new URL("../../../web/dist/", import.meta.url));

/** Prefixes static serving and the fallback NEVER touch.
 *
 *  `/api`: an unknown route must be 404, never `index.html`, or the screen shows a parse error
 *  instead of the real status (see the head of `web/src/api/client.ts`). `/internal`: the
 *  containers' channel. `/webhooks` (03/09): exposed publicly by the funnel; without this, a GET
 *  on any `/webhooks/...` served the whole screen to the Internet. Anchored with `(/|$)` so a
 *  screen view starting with those letters is not caught. */
const RESERVED = /^\/(api|internal|webhooks)(\/|$)/;

/** Returned at the root when there is no screen: who owns `/` depends on the build being there. */
const SERVICE_CARD = {
  service: "legion-control-plane",
  ui: "http://localhost:5173",
  api: ["/api/bootstrap", "/api/tasks", "/api/sessions/:id/live"],
};

/** Checks `index.html`, not the folder: an empty `web/dist/` (interrupted build) would mount static
 *  serving that only returns 404, harder to understand than none at all. */
export function spaIsBuilt(dir: string = DIST): boolean {
  return existsSync(path.join(dir, "index.html"));
}

/** Call LAST. `dir` exists only for tests. */
export function registerStaticRoutes(app: Hono, dir: string = DIST): void {
  if (!spaIsBuilt(dir)) {
    app.get("/", (c) => c.json(SERVICE_CARD));
    return;
  }

  // `serveStatic` wants `root` relative to the cwd and refuses absolute paths, so we pass the path
  // from the cwd, which works whatever it is. Computed once: a process's cwd does not move.
  const root = path.relative(process.cwd(), dir) || ".";
  const files = serveStatic({ root });
  const index = serveStatic({ root, path: "index.html" });

  // `use`, not `get`, so HEAD requests are served like GET.
  app.use("*", (c, next) => (RESERVED.test(c.req.path) ? next() : files(c, next)));
  // SPA fallback: a view URL pasted in a new tab must render the app. `serveStatic` calls `next()`
  // when the file does not exist, so this only sees what was not served above.
  app.get("*", (c, next) => (RESERVED.test(c.req.path) ? next() : index(c, next)));
}
