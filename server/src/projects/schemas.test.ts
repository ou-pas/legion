// What the `projects` schemas refuse (06/09, audit wave 2). Three properties invisible when reading a
// `z.strictObject`:
//
//   1. an unknown key is refused by name; silently dropping it would close the hole too, but the UI
//      would believe its request was heard as sent;
//   2. `hue: null` and a missing `hue` are different bodies: the first removes the choice, the second
//      touches nothing, and merging them would clear the hue whenever the name is saved;
//   3. the messages written by hand (repoAccess, forge) survive zod, since "expected one of …" says
//      there is a bug, not what to fix.
//
// Boundary tests: no database. Rules needing the database or the scale live in the services.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseBody } from "../http/parse-body.js";
import { agentCreateBody, projectPatchBody, repoCreateBody, secretPatchBody } from "./schemas.js";
import type { z } from "zod";

/** `parseBody` expects a Hono context and reads one thing from it: that is all that is mounted. */
const body = (raw: unknown) => ({ req: { json: async () => raw } });

async function refuse<T>(schema: z.ZodType<T>, raw: unknown): Promise<string> {
  const parsed = await parseBody(body(raw), schema);
  assert.equal(parsed.ok, false, `${JSON.stringify(raw)} should have been refused`);
  return parsed.ok ? "" : parsed.error;
}

async function accept<T>(schema: z.ZodType<T>, raw: unknown): Promise<T> {
  const parsed = await parseBody(body(raw), schema);
  if (!parsed.ok) assert.fail(parsed.error);
  return parsed.value;
}

describe("projects domain bodies", () => {
  it("name the unknown key instead of dropping it", async () => {
    assert.match(await refuse(projectPatchBody, { hue: 3, colour: 4 }), /colour/);
    assert.match(
      await refuse(repoCreateBody, {
        projectId: "p",
        name: "web",
        url: "https://github.com/o/r",
        branchName: "main",
      }),
      /branchName/,
    );
  });

  it("tell `hue: null` from a missing `hue`", async () => {
    assert.deepEqual(await accept(projectPatchBody, { hue: null }), { hue: null });
    assert.equal("hue" in (await accept(projectPatchBody, { context: "x" })), false);
  });

  it('refuse the "3" of a miswired <select>: an input\'s value is a string', async () => {
    assert.match(await refuse(projectPatchBody, { hue: "3" }), /hue/);
  });

  it("keep the hand-written repoAccess message rather than zod's", async () => {
    const error = await refuse(agentCreateBody, {
      name: "shady",
      rolePrompt: "x",
      repoAccess: "admin",
    });
    assert.match(error, /invalid repoAccess/);
    assert.match(error, /none, read, write/);
  });

  it("keep the forge one too, empty string included: the client did send a field", async () => {
    assert.match(
      await refuse(repoCreateBody, { projectId: "p", name: "web", url: "https://x", forge: "" }),
      /invalid forge/,
    );
    assert.match(
      await refuse(repoCreateBody, {
        projectId: "p",
        name: "web",
        url: "https://x",
        forge: "bitbucket",
      }),
      /“bitbucket”/,
    );
  });

  it("accept a null secret label: never named and cleared stay one state", async () => {
    assert.deepEqual(await accept(secretPatchBody, { label: null }), { label: null });
  });

  it("refuse an unreadable body without throwing", async () => {
    const parsed = await parseBody(
      { req: { json: () => Promise.reject(new Error("boom")) } },
      projectPatchBody,
    );
    assert.deepEqual(parsed, { ok: false, error: "invalid body: unreadable JSON" });
  });
});
