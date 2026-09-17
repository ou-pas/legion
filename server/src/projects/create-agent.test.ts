// Creating an agent from scratch (04/09). There was no way: an agent came from a library template
// (which imposes its name) or from the seed, so a "design" role no library had could only be made by
// promoting an existing agent and instantiating it under its old name.
//
// Held here: the route creates a named agent with the same defaults as a library install (its folder,
// nothing else; `agentValues` is shared) and refuses by naming the cause. Same harness as
// `read-only-task.test.ts`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-create-agent-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerProjectRoutes } = await import("./routes.js");
const { REPO_ACCESS } = await import("../shared/enums.js");

const app = new Hono();
registerProjectRoutes(app);

const PROJECT = "p1";
db.insert(schema.projects)
  .values({ id: PROJECT, name: "P", slug: "p", createdAt: new Date() })
  .run();

async function create(projectId: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(`/api/projects/${projectId}/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /api/projects/:id/agents: a named agent, from scratch", () => {
  it("creates the agent with the same defaults as a library install", async () => {
    const r = await create(PROJECT, {
      name: "design",
      title: "Proposes an interface",
      rolePrompt: "You propose, you do not code.",
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.name, "design");
    assert.equal(r.json.projectId, PROJECT);
    // Least privilege: its folder, nothing else, exactly what `agentValues` sets for a library agent.
    // A different default here would be two ways to be born.
    assert.deepEqual(JSON.parse(r.json.fsGrants), [
      { folderPath: "/agents/design", canRead: true, canWrite: true, canDelete: false },
    ]);
    assert.equal(r.json.repoAccess, REPO_ACCESS.none, "no repository until granted");
    assert.equal(
      r.json.inboxAccess,
      true,
      "it can ask questions: the only channel to the operator",
    );
    assert.deepEqual(JSON.parse(r.json.skillNames), []);
  });

  it("accepts grants set up front", async () => {
    const r = await create(PROJECT, {
      name: "reader",
      rolePrompt: "x",
      repoAccess: REPO_ACCESS.read,
      skillNames: ["impeccable"],
      inboxAccess: false,
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.repoAccess, REPO_ACCESS.read);
    assert.deepEqual(JSON.parse(r.json.skillNames), ["impeccable"]);
    assert.equal(r.json.inboxAccess, false);
  });

  it("refuses a name taken in this project, naming it: same rule as installAgent", async () => {
    const r = await create(PROJECT, { name: "design", rolePrompt: "again" });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /“design” already exists/);
  });

  it("refuses a name that would not fit in a path", async () => {
    // The name ends up in `/agents/<name>` and in the prompt: spaces, uppercase and accents (the
    // accented "été" is deliberate) would make a folder no built-in agent has.
    for (const name of ["Design Lead", "été", "a/b", ""]) {
      const r = await create(PROJECT, { name, rolePrompt: "x" });
      assert.equal(r.status, 400, `“${name}” should be refused`);
    }
  });

  it("refuses an empty role prompt, and an unknown repoAccess", async () => {
    assert.equal((await create(PROJECT, { name: "empty", rolePrompt: "   " })).status, 400);
    const r = await create(PROJECT, { name: "shady", rolePrompt: "x", repoAccess: "admin" });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /invalid repoAccess/);
  });

  it("404 on an unknown project, not a 500", async () => {
    const r = await create("nope", { name: "x", rolePrompt: "x" });
    assert.equal(r.status, 404);
  });
});
