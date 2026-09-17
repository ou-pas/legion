// Database access of `grant-revoke-store.ts`, on a real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-grant-revoke-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentsOfProject,
  allAgents,
  mcpServerProjectId,
  ruleProjectId,
  updateAgentFields,
  withTransaction,
} = await import("./grant-revoke-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.rules)
  .values({ id: "r1", projectId: "p1", name: "r1", content: "c", createdAt: now })
  .run();
db.insert(schema.mcpServers)
  .values({ id: "m1", projectId: "p1", name: "m1", config: "{}", createdAt: now })
  .run();

describe("grant-revoke-store", () => {
  it("returns the owning project of a rule and an MCP server, or `null`", () => {
    assert.equal(ruleProjectId("r1"), "p1");
    assert.equal(ruleProjectId("nope"), null);
    assert.equal(mcpServerProjectId("m1"), "p1");
    assert.equal(mcpServerProjectId("nope"), null);
  });

  it("lists a project's agents, and all agents", () => {
    assert.equal(agentsOfProject("p1").length, 1);
    assert.equal(allAgents().length, 1);
  });

  it("writes an agent field inside a transaction", () => {
    withTransaction(() => updateAgentFields("a1", { ruleIds: JSON.stringify(["r1"]) }));
    assert.equal(agentsOfProject("p1")[0]?.ruleIds, JSON.stringify(["r1"]));
  });
});
