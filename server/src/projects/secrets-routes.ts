// A project's secrets: add, label, remove. Moved out of `projects/routes.ts` on 30/08; the rules went
// to `secrets.ts` on 06/09.
//
// A secret's value never leaves: the list returns the variable name and the label.
import type { Hono } from "hono";
import { db, schema } from "../shared/db.js";
import { parseBody } from "../http/parse-body.js";
import { deleteSecret, putSecret, setSecretLabel } from "./secrets.js";
import { secretCreateBody, secretPatchBody } from "./schemas.js";

export function registerSecretRoutes(app: Hono): void {
  // The label comes out with the name, without the master key: it lives in its own column, not in the
  // ciphertext (v48), so a key that no longer decrypts can still be named.
  app.get("/api/secrets", (c) =>
    c.json(
      db
        .select({
          id: schema.secrets.id,
          name: schema.secrets.name,
          label: schema.secrets.label,
          projectId: schema.secrets.projectId,
        })
        .from(schema.secrets)
        .all(),
    ),
  );

  app.post("/api/secrets", async (c) => {
    const body = await parseBody(c, secretCreateBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    const put = putSecret(body.value);
    if (!put.ok) return c.json({ error: put.error }, put.status);
    return c.json({ ok: true, replaced: put.replaced }, 201);
  });

  app.patch("/api/secrets/:id", async (c) => {
    const body = await parseBody(c, secretPatchBody);
    if (!body.ok) return c.json({ error: body.error }, 400);
    if (!setSecretLabel(c.req.param("id"), body.value.label))
      return c.json({ error: "secret not found" }, 404);
    return c.json({ ok: true });
  });

  app.delete("/api/secrets/:id", (c) => {
    if (!deleteSecret(c.req.param("id"))) return c.json({ error: "secret not found" }, 404);
    return c.json({ ok: true });
  });
}
