// Protects against ghost grants: an agent referencing a deleted skill, rule or MCP server does not
// show on screen, but breaks the next session launch when the runtime mounts a missing folder or
// starts a missing server.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-grant-revoke-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { revokeGrantEverywhere } = await import("./grant-revoke.js");

const P1 = "p1";
const P2 = "p2";
const A1 = "a1"; // project 1, holds every grant
const A2 = "a2"; // project 2, holds the same ids (the case scoping must settle)

beforeEach(() => {
  const now = new Date();
  db.delete(schema.agents).run();
  db.delete(schema.rules).run();
  db.delete(schema.mcpServers).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values([
      { id: P1, name: "P1", slug: "p1", createdAt: now },
      { id: P2, name: "P2", slug: "p2", createdAt: now },
    ])
    .run();
  db.insert(schema.rules)
    .values({
      id: "rule-1",
      projectId: P1,
      name: "r",
      content: "c",
      createdAt: now,
    })
    .run();
  db.insert(schema.mcpServers)
    .values({
      id: "mcp-1",
      projectId: P1,
      name: "github",
      config: JSON.stringify({ command: "x" }),
      createdAt: now,
    })
    .run();
  db.insert(schema.agents)
    .values([
      {
        id: A1,
        projectId: P1,
        name: "a1",
        rolePrompt: "r",
        createdAt: now,
        skillNames: JSON.stringify(["lean-ctx", "grilling"]),
        ruleIds: JSON.stringify(["rule-1", "rule-2"]),
        mcpServerIds: JSON.stringify(["mcp-1"]),
      },
      {
        id: A2,
        projectId: P2,
        name: "a2",
        rolePrompt: "r",
        createdAt: now,
        skillNames: JSON.stringify(["lean-ctx"]),
        ruleIds: JSON.stringify(["rule-1"]),
        mcpServerIds: JSON.stringify(["mcp-1"]),
      },
    ])
    .run();
});

const agent = (id: string) => db.select().from(schema.agents).where(eq(schema.agents.id, id)).get();
const grants = (id: string) => {
  const row = agent(id);
  return {
    skills: JSON.parse(row?.skillNames ?? "[]") as string[],
    rules: JSON.parse(row?.ruleIds ?? "[]") as string[],
    mcp: JSON.parse(row?.mcpServerIds ?? "[]") as string[],
  };
};

describe("revokeGrantEverywhere, a deleted capability leaves agent cards", () => {
  it("removes a global skill from every agent in every project", () => {
    assert.equal(revokeGrantEverywhere("skill", "lean-ctx"), 2);
    assert.deepEqual(grants(A1).skills, ["grilling"]);
    assert.deepEqual(grants(A2).skills, []);
  });

  it("keeps a rule to its project: the other project's same id is untouched", () => {
    assert.equal(revokeGrantEverywhere("rule", "rule-1"), 1);
    assert.deepEqual(grants(A1).rules, ["rule-2"]);
    assert.deepEqual(grants(A2).rules, ["rule-1"]);
  });

  it("keeps an MCP server to its project the same way", () => {
    assert.equal(revokeGrantEverywhere("mcpServer", "mcp-1"), 1);
    assert.deepEqual(grants(A1).mcp, []);
    assert.deepEqual(grants(A2).mcp, ["mcp-1"]);
  });

  it("touches only the removed capability's column", () => {
    revokeGrantEverywhere("rule", "rule-1");
    assert.deepEqual(grants(A1).skills, ["lean-ctx", "grilling"]);
    assert.deepEqual(grants(A1).mcp, ["mcp-1"]);
  });

  it("changes nothing and does not throw for an id nobody holds", () => {
    assert.equal(revokeGrantEverywhere("skill", "never-granted"), 0);
    assert.deepEqual(grants(A1).skills, ["lean-ctx", "grilling"]);
  });

  it("still clears grants of an already deleted row, sweeping every project", () => {
    db.delete(schema.rules).where(eq(schema.rules.id, "rule-1")).run();
    assert.equal(revokeGrantEverywhere("rule", "rule-1"), 2);
    assert.deepEqual(grants(A1).rules, ["rule-2"]);
    assert.deepEqual(grants(A2).rules, []);
  });
});
