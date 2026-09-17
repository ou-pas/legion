// Database access of `mcp-edit-store.ts`, on a real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-mcp-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  deleteMcpServerRow,
  getMcpServer,
  insertMcpServer,
  mcpServersOf,
  setMcpServerAllAgentsField,
} = await import("./mcp-edit-store.js");

db.insert(schema.projects)
  .values({ id: "p1", name: "P1", slug: "p1", createdAt: new Date() })
  .run();

describe("mcp-edit-store", () => {
  it("inserts a server, reads it and lists it by project", () => {
    insertMcpServer({
      id: "m1",
      projectId: "p1",
      name: "m1",
      config: "{}",
      allowedHosts: "[]",
      allAgents: false,
      createdAt: new Date(),
    });
    assert.equal(getMcpServer("m1")?.name, "m1");
    assert.equal(mcpServersOf("p1").length, 1);
    assert.equal(mcpServersOf(undefined).length, 1);
    assert.equal(mcpServersOf("other-project").length, 0);
  });

  it("edits `allAgents` then deletes the row", () => {
    setMcpServerAllAgentsField("m1", true);
    assert.equal(getMcpServer("m1")?.allAgents, true);
    deleteMcpServerRow("m1");
    assert.equal(getMcpServer("m1"), undefined);
  });
});
