// A project's Claude credentials as the UI sees them: the ordered list and the account in use.
//
// These routes answer "why is my session running on this account". The former singular
// `GET /api/projects/:id/credential` half-answered it without rank or exhaustion; the "Claude
// credentials" card on the Project screen replaced it, and the route was removed (08/09).
//
// The value never leaves, not even a prefix: that would mean decrypting in a handler.
import type { Hono } from "hono";
import { parseBody } from "../../http/parse-body.js";
import { resolveProjectCredential } from "../auth.js";
import {
  addCredential,
  credentialsOfProject,
  deleteCredential,
  moveCredential,
  setCredentialLabel,
} from "./index.js";
import { credentialCreateBody, credentialPatchBody } from "../schemas.js";

export function registerCredentialRoutes(app: Hono): void {
  app.get("/api/projects/:id/credentials", (c) => {
    const projectId = c.req.param("id");
    const active = resolveProjectCredential(projectId);
    return c.json({
      credentials: credentialsOfProject(projectId),
      // The account in use now, as resolution itself says it: a UI redoing the reasoning ends up
      // showing another account than the real one.
      active: {
        credentialId: active.credentialId,
        from: active.from,
        name: active.credentialName,
        label: active.credentialLabel,
        available: active.available,
        retryAt: active.retryAt,
      },
    });
  });

  app.post("/api/projects/:id/credentials", async (c) => {
    const body = await parseBody(c, credentialCreateBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    // Fields are named one by one: a body from the network is not spread into a service.
    const added = addCredential({
      projectId: c.req.param("id"),
      value: body.value.value,
      name: body.value.name,
      label: body.value.label,
    });
    if (!added.ok) return c.json({ error: added.error }, added.status);
    return c.json({ ok: true, id: added.id, rank: added.rank }, 201);
  });

  // Label and rank in one route, never the value: renewing a token means adding another. Both
  // fields are optional; a request with neither does nothing.
  app.patch("/api/credentials/:id", async (c) => {
    const body = await parseBody(c, credentialPatchBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const id = c.req.param("id");
    if (body.value.label !== undefined && !setCredentialLabel(id, body.value.label))
      return c.json({ error: "credential not found" }, 404);
    if (body.value.rank !== undefined && !moveCredential(id, body.value.rank))
      return c.json({ error: "credential not found" }, 404);
    return c.json({ ok: true });
  });

  app.delete("/api/credentials/:id", (c) => {
    if (!deleteCredential(c.req.param("id"))) return c.json({ error: "credential not found" }, 404);
    return c.json({ ok: true });
  });
}
