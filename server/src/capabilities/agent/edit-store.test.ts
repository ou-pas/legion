// Database access of `edit-store.ts`, on a real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-agent-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const {
  getAgent,
  getEnvironment,
  getProject,
  mcpServerIdsOfProject,
  mcpServersOfProject,
  repoNamesOfProject,
  ruleIdsOfProject,
  secretNamesOfProject,
  updateAgent,
} = await import("./edit-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.repos)
  .values({ id: "repo1", projectId: "p1", name: "mono", url: "git@x", createdAt: now })
  .run();
db.insert(schema.rules)
  .values({ id: "rule1", projectId: "p1", name: "rule1", content: "c", createdAt: now })
  .run();
db.insert(schema.secrets)
  .values({ id: "s1", projectId: "p1", name: "TOK", ciphertext: "x", createdAt: now })
  .run();
db.insert(schema.mcpServers)
  .values({ id: "mcp1", projectId: "p1", name: "mcp1", config: "{}", createdAt: now })
  .run();
db.insert(schema.environments).values({ id: "env1", projectId: "p1", name: "env1" }).run();

describe("agent-edit-store", () => {
  it("returns the agent and the project by id", () => {
    assert.equal(getAgent("a1")?.name, "a1");
    assert.equal(getProject("p1")?.slug, "p1");
  });

  it("returns the project's known ids and names, to check grants against", () => {
    assert.deepEqual(repoNamesOfProject("p1"), ["mono"]);
    assert.deepEqual(ruleIdsOfProject("p1"), ["rule1"]);
    assert.deepEqual(secretNamesOfProject("p1"), ["TOK"]);
    assert.deepEqual(mcpServerIdsOfProject("p1"), ["mcp1"]);
    assert.deepEqual(mcpServersOfProject("p1"), [{ id: "mcp1", name: "mcp1", allAgents: false }]);
  });

  it("returns the environment by id", () => {
    assert.equal(getEnvironment("env1")?.name, "env1");
    assert.equal(getEnvironment("nope"), undefined);
  });

  it("updates the agent", () => {
    updateAgent("a1", { title: "new title" });
    assert.equal(getAgent("a1")?.title, "new title");
  });
});
