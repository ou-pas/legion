// What this file protects: a network wall set from the app, set right.
//
//  1. Only `limited` is created. If a form field could set `open`, least privilege would rest on
//     the client's goodwill.
//  2. A host is a host. Three entries pass into the database and fail at runtime: a comma (it
//     splits the proxy's allowlist line), a lone wildcard (opens everything), a full URL (never
//     matches). They are refused by name, not logged.
//  3. Deleting is refused while an agent references the environment, unlike rules and MCP servers.
//     An allowlist vanishing under a live agent is a security change, not orphan cleanup.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-env-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentsUsing,
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  normalizeHost,
  patchEnvironment,
} = await import("./environments.js");
const { NETWORKING } = await import("../shared/enums.js");

const P1 = "p1";

function reset() {
  const now = new Date();
  db.delete(schema.agents).run();
  db.delete(schema.environments).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
}

function agent(id: string, name: string, environmentId: string | null) {
  db.insert(schema.agents)
    .values({
      id,
      projectId: P1,
      name,
      rolePrompt: "r",
      environmentId,
      createdAt: new Date(),
    })
    .run();
}

const created = (name: string, hosts: string[] = []) => {
  const r = createEnvironment({ projectId: P1, name, allowedHosts: hosts });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) throw new Error("unreachable");
  return r.value;
};

beforeEach(reset);

describe("createEnvironment", () => {
  it("always creates a limited network, never an open one", () => {
    const env = created("ci", ["github.com"]);
    assert.equal(env.networking, "limited");
    assert.deepEqual(env.allowedHosts, ["github.com"]);
  });

  it("a new environment with no host is a wall, not an error", () => {
    assert.deepEqual(created("closed").allowedHosts, []);
  });

  it("refuses a name already taken in the project, case-insensitively", () => {
    created("ci");
    const r = createEnvironment({ projectId: P1, name: "CI" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 409);
    assert.match(r.error, /already exists/);
  });

  it("refuses an unknown project: no orphan environment", () => {
    const r = createEnvironment({ projectId: "ghost", name: "ci" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 404);
  });

  it("normalises case and removes duplicates", () => {
    assert.deepEqual(created("ci", ["GitHub.com", "github.com", " npmjs.org "]).allowedHosts, [
      "github.com",
      "npmjs.org",
    ]);
  });
});

describe("normalizeHost: three ways to open the wall unknowingly", () => {
  it("refuses a comma: it would split the proxy's allowlist line", () => {
    const r = normalizeHost("github.com,evil.example");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /comma/);
  });

  it("refuses a lone wildcard: it would no longer be an allowlist", () => {
    for (const bad of ["*", "*.*"]) {
      const r = normalizeHost(bad);
      assert.equal(r.ok, false, `“${bad}” should have been refused`);
      if (!r.ok) assert.match(r.error, /would allow everything/);
    }
  });

  it("refuses a full URL: the proxy matches a host, a URL would match nothing", () => {
    const r = normalizeHost("https://api.github.com/repos");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /with no scheme and no path/);
  });

  it("allows a subdomain wildcard: the normal use", () => {
    const r = normalizeHost("*.githubusercontent.com");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "*.githubusercontent.com");
  });
});

describe("patchEnvironment", () => {
  it("renames and replaces the allowlist", () => {
    const env = created("ci", ["github.com"]);
    const r = patchEnvironment(env.id, { name: "build", allowedHosts: ["registry.npmjs.org"] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.name, "build");
    assert.deepEqual(r.value.allowedHosts, ["registry.npmjs.org"]);
  });

  it("refuses to edit an open environment's allowlist: the runtime would ignore it", () => {
    db.insert(schema.environments)
      .values({
        id: "e-open",
        projectId: P1,
        name: "open",
        networking: NETWORKING.open,
        allowedHosts: "[]",
      })
      .run();
    const r = patchEnvironment("e-open", { allowedHosts: ["github.com"] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 400);
  });

  it("an open environment stays renamable", () => {
    db.insert(schema.environments)
      .values({
        id: "e-open",
        projectId: P1,
        name: "open",
        networking: NETWORKING.open,
        allowedHosts: "[]",
      })
      .run();
    const r = patchEnvironment("e-open", { name: "legacy" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.networking, "open", "renaming switches nothing");
  });

  it("404 on an unknown id", () => {
    const r = patchEnvironment("ghost", { name: "x" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 404);
  });
});

describe("deleteEnvironment", () => {
  it("refuses while an agent carries it, and names the agents", () => {
    const env = created("ci");
    agent("a1", "front", env.id);
    agent("a2", "server", env.id);
    const r = deleteEnvironment(env.id);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 409);
    assert.deepEqual(r.agentNames, ["front", "server"]);
    assert.match(r.error, /front, server/, "the sentence reads on its own, the UI shows it as is");
    assert.equal(listEnvironments(P1).length, 1, "and nothing was deleted");
  });

  it("deletes once no agent carries it", () => {
    const env = created("ci");
    agent("a1", "front", null);
    assert.deepEqual(agentsUsing(env.id), []);
    assert.equal(deleteEnvironment(env.id).ok, true);
    assert.deepEqual(listEnvironments(P1), []);
  });
});
