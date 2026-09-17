// Database access of `capabilities-store.ts`, on a real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-capabilities-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  getProject,
  insertRule,
  mcpServersOfProject,
  rulesOfProject,
  secretsOfProject,
  setProjectContext,
} = await import("./capabilities-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.mcpServers)
  .values({ id: "mcp1", projectId: "p1", name: "mcp1", config: "{}", createdAt: now })
  .run();
db.insert(schema.secrets)
  .values({ id: "s1", projectId: "p1", name: "TOK", ciphertext: "x", createdAt: now })
  .run();

describe("capabilities-store", () => {
  it("reads and updates the project's living context", () => {
    assert.equal(getProject("p1")?.context, "");
    setProjectContext("p1", "updated context");
    assert.equal(getProject("p1")?.context, "updated context");
  });

  it("inserts a rule (default columns omitted) and finds it in the project", () => {
    insertRule({
      id: "rule1",
      projectId: "p1",
      name: "rule1",
      content: "c",
      allAgents: true,
      status: "suggested",
      createdAt: now,
    });
    assert.equal(rulesOfProject("p1").find((r) => r.id === "rule1")?.status, "suggested");
  });

  it("lists a project's MCP servers and secrets", () => {
    assert.equal(mcpServersOfProject("p1").length, 1);
    assert.equal(secretsOfProject("p1").length, 1);
  });
});
