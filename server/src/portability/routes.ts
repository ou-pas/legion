// A project's encrypted crate.
//
// Nothing is written to the server's disk, on export or import: export returns the file content
// for the UI to download, import reads the content in memory. A crate passing through
// `server/data` would end up in a backup or a commit someday.
//
// The passphrase is never logged, never in a URL, never in an error message. That is why preview
// is a POST even though it changes nothing: a GET would put the passphrase in a query string.
import { Hono } from "hono";
import { db, schema } from "../shared/db.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody } from "../http/parse-body.js";
import { crateFilename, openCrate, sealCrate, PASSPHRASE_MIN } from "./crate.js";
import {
  collectCrate,
  crateManifest,
  CRATE_PARTS,
  DEFAULT_INCLUDE,
  type CrateInclude,
} from "./crate-collect.js";
import { applyCrate, summarizeCrate } from "./crate-apply.js";

/** A string, not a coercion (06/09). `String(body.passphrase ?? "")` turned a number sent by
 *  mistake into a valid passphrase. The minimum length is checked in the route. */
const passphrase = z.string();
const sealCrateBody = z.strictObject({ passphrase, include: z.unknown().optional() });
const openCrateBody = z.strictObject({ content: z.string(), passphrase });
const importCrateBody = z.strictObject({
  content: z.string(),
  passphrase,
  name: z.string().optional(),
});

function readInclude(raw: unknown): CrateInclude {
  const given = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_INCLUDE };
  for (const part of CRATE_PARTS) if (typeof given[part] === "boolean") out[part] = given[part];
  return out;
}

function fail(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

export function registerPortabilityRoutes(app: Hono): void {
  app.get("/api/projects/:id/crate/manifest", (c) => {
    try {
      return c.json(crateManifest(c.req.param("id")));
    } catch (e) {
      return c.json({ error: fail(e) }, 404);
    }
  });

  app.post("/api/projects/:id/crate", async (c) => {
    const parsed = await parseBody(c, sealCrateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const body = parsed.value;
    if (body.passphrase.length < PASSPHRASE_MIN)
      return c.json({ error: `passphrase of at least ${PASSPHRASE_MIN} characters` }, 400);
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, c.req.param("id")))
      .get();
    if (!project) return c.json({ error: "project not found" }, 404);
    try {
      const payload = collectCrate(project.id, readInclude(body.include));
      return c.json({
        filename: crateFilename(project.slug),
        content: sealCrate(payload, body.passphrase),
      });
    } catch (e) {
      // `collectCrate` throws when the master key is missing; the message never names a secret value.
      return c.json({ error: fail(e) }, 400);
    }
  });

  // The `catch` in these two routes stays: "this passphrase does not decrypt the crate" is a 400,
  // not a server fault. Leaving it to `app.onError` would turn the most common import case, a typo,
  // into an anonymous 500 with a stack trace in the log.
  app.post("/api/crate/preview", async (c) => {
    const parsed = await parseBody(c, openCrateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      return c.json(summarizeCrate(openCrate(parsed.value.content, parsed.value.passphrase)));
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });

  app.post("/api/crate/import", async (c) => {
    const parsed = await parseBody(c, importCrateBody);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      const payload = openCrate(parsed.value.content, parsed.value.passphrase);
      return c.json(applyCrate(payload, parsed.value.name), 201);
    } catch (e) {
      return c.json({ error: fail(e) }, 400);
    }
  });
}
