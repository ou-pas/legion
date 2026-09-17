// The HTTP app: Hono, CORS, the origin and operator guards, lookup and bootstrap.
// Domain routes live in their domain (each exports registerXRoutes).
import { Hono } from "hono";
import { cors } from "hono/cors";
import { allAgents, allProjects, allRunners, allTaskTemplates } from "./http-store.js";
import { httpErrorHandler, notFoundHandler } from "./errors.js";
import { allowedOrigin, mutationOriginGuard } from "./guard.js";
import { operatorGuard } from "../operator/operator-guard.js";
import { lookupId } from "./lookup.js";

export const app = new Hono();

// CORS asks the same question as `mutationOriginGuard` below (may this page drive the API?), so
// both read one predicate, or they drift. Since 13/09 the answer is "same origin".
app.use(
  "*",
  cors({ origin: (origin, c) => (allowedOrigin(origin, c.req.header("host")) ? origin : null) }),
);

// Exported from `guard.ts` so route tests mount it the way this file does.
app.use("*", mutationOriginGuard);

// Who may act (13/09). The two guards above say which page may talk; this one says who. It came
// the day addresses stopped telling callers apart: an agent container on a remote machine exits
// through its host, in 100.x, like the operator's browser. Measured on 13/09: a `curl` from a
// runner machine got 200 on `/api/bootstrap`.
//
// After CORS, or a 401 on a preflighted request would lack the headers that let the browser read it.
app.use("*", operatorGuard);

// Error → status translation in one place. It replaced a `catch (err) → 400` copied into some forty
// routes, which flattened 404, 409 and server faults onto one code and leaked the raw exception
// message. The bodies live in `errors.ts` so route tests can mount them on their own `Hono`.
app.onError(httpErrorHandler);
app.notFound(notFoundHandler);

// The root route is not here: it belongs to `static.ts`. Registered here it would win over the
// static files, since Hono follows registration order and this file is imported first.

// What an id designates (26/08). Next to `bootstrap` because the question crosses four domains
// and belongs to none. 404 when nothing matches: the screen tells "not an id" (it does not ask)
// from "unknown id" (it asks and gets nothing).
app.get("/api/lookup/:id", (c) => {
  const hit = lookupId(c.req.param("id"));
  return hit ? c.json(hit) : c.json({ error: "unknown id" }, 404);
});
app.get("/api/bootstrap", (c) => {
  const templates = allTaskTemplates().map((t) => ({
    ...t,
    steps: JSON.parse(t.steps) as unknown,
  }));
  return c.json({
    projects: allProjects(),
    agents: allAgents(),
    runners: allRunners(),
    templates,
  });
});

// New project — usable immediately: a default agent and an open environment are seeded with it.
