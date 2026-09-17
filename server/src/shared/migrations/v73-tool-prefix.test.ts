// Tool grants survive the product rename (v73, 14/09): `mcp__agentos__` became `mcp__legion__` in
// code but not in explicit `allowed_tools` rows. The real migration runs here, imported: copying
// its SQL into the test would pass even with a wrong migration.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import Database from "better-sqlite3";
import { v73 } from "./v71-v75.js";

const dir = mkdtempSync(join(tmpdir(), "legion-v73-"));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Only the two tables the migration touches, so the test would notice a third. */
function db(name: string): Database.Database {
  const sqlite = new Database(join(dir, `${name}.db`));
  sqlite.exec(`
CREATE TABLE agents (id TEXT PRIMARY KEY, allowed_tools TEXT);
CREATE TABLE agent_templates (id TEXT PRIMARY KEY, allowed_tools TEXT);
`);
  return sqlite;
}

const toolsOf = (sqlite: Database.Database, table: string, id: string) =>
  (
    sqlite.prepare(`SELECT allowed_tools FROM ${table} WHERE id = ?`).get(id) as {
      allowed_tools: string | null;
    }
  ).allowed_tools;

describe("v73, internal tool prefix", () => {
  it("rewrites `mcp__agentos__` to `mcp__legion__` in an agent's grants", () => {
    const sqlite = db("agents");
    sqlite
      .prepare("INSERT INTO agents VALUES (?, ?)")
      .run(
        "a1",
        JSON.stringify(["Bash", "mcp__agentos__inbox_ask", "mcp__agentos__fs_write", "WebSearch"]),
      );

    v73(sqlite);

    assert.deepEqual(JSON.parse(toolsOf(sqlite, "agents", "a1")!), [
      "Bash",
      "mcp__legion__inbox_ask",
      "mcp__legion__fs_write",
      "WebSearch",
    ]);
  });

  // Why only one agent broke: the default set is computed in code.
  it("leaves an agent without explicit grants", () => {
    const sqlite = db("default");
    sqlite.prepare("INSERT INTO agents VALUES (?, ?)").run("a2", null);
    v73(sqlite);
    assert.equal(toolsOf(sqlite, "agents", "a2"), null);
  });

  it("leaves another MCP server's tools intact", () => {
    const sqlite = db("others");
    const before = JSON.stringify(["mcp__github__create_pr", "mcp__legion__fs_read", "Read"]);
    sqlite.prepare("INSERT INTO agents VALUES (?, ?)").run("a1", before);
    v73(sqlite);
    assert.equal(toolsOf(sqlite, "agents", "a1"), before);
  });

  it("also rewrites agent templates, which have the same column", () => {
    const sqlite = db("templates");
    sqlite
      .prepare("INSERT INTO agent_templates VALUES (?, ?)")
      .run("t1", JSON.stringify(["mcp__agentos__update_task"]));
    v73(sqlite);
    assert.match(toolsOf(sqlite, "agent_templates", "t1")!, /mcp__legion__update_task/);
  });

  it("sets the version", () => {
    const sqlite = db("version");
    v73(sqlite);
    assert.equal(sqlite.pragma("user_version", { simple: true }), 73);
  });
});
