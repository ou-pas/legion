// Protects the project boundary of an agent's grants and the atomicity of the write, the two
// things the schema cannot express:
//
//  1. Granted repositories, rules, secrets, MCP servers and environments belong to the agent's
//     project; otherwise the session would carry another project's allowlist, keys or clones.
//  2. An unknown id is refused by name, never filtered: a ticked box with nothing granted is the
//     worst outcome.
//  3. Everything is validated, then everything is written. A half-valid body writes nothing.
//
// `routes.test.ts` covers the route wiring; this exercises the service alone.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-agent-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const { applyAgentEdit } = await import("./edit.js");

const P1 = "p1";
const P2 = "p2";
const A1 = "a1";

beforeEach(() => {
  const now = new Date();
  db.delete(schema.agents).run();
  db.delete(schema.secrets).run();
  db.delete(schema.rules).run();
  db.delete(schema.mcpServers).run();
  db.delete(schema.repos).run();
  db.delete(schema.environments).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values([
      { id: P1, name: "P1", slug: "p1", createdAt: now },
      { id: P2, name: "P2", slug: "p2", createdAt: now },
    ])
    .run();
  db.insert(schema.repos)
    .values([
      {
        id: "repo-1",
        projectId: P1,
        name: "api",
        url: "https://example.test/api.git",
        createdAt: now,
      },
      {
        id: "repo-2",
        projectId: P2,
        name: "other",
        url: "https://example.test/other.git",
        createdAt: now,
      },
    ])
    .run();
  db.insert(schema.rules)
    .values([
      { id: "rule-1", projectId: P1, name: "r1", content: "c", createdAt: now },
      { id: "rule-2", projectId: P2, name: "r2", content: "c", createdAt: now },
    ])
    .run();
  db.insert(schema.secrets)
    .values([
      { id: "sec-1", projectId: P1, name: "TOKEN", ciphertext: "x", createdAt: now },
      { id: "sec-2", projectId: P2, name: "OTHER_TOKEN", ciphertext: "x", createdAt: now },
    ])
    .run();
  db.insert(schema.mcpServers)
    .values([
      {
        id: "mcp-1",
        projectId: P1,
        name: "github",
        config: JSON.stringify({ command: "x" }),
        createdAt: now,
      },
      {
        id: "mcp-2",
        projectId: P2,
        name: "elsewhere",
        config: JSON.stringify({ command: "x" }),
        createdAt: now,
      },
    ])
    .run();
  db.insert(schema.environments)
    .values([
      { id: "env-1", projectId: P1, name: "open" },
      { id: "env-2", projectId: P2, name: "elsewhere" },
    ])
    .run();
  // `inboxAccess: false`: otherwise any `allowedTools` without the two inbox tools is refused
  // (tool-grants.ts, tested elsewhere), which would mask what is checked here.
  db.insert(schema.agents)
    .values({
      id: A1,
      projectId: P1,
      name: "agent",
      rolePrompt: "role",
      inboxAccess: false,
      createdAt: now,
    })
    .run();
});

const agent = () => db.select().from(schema.agents).where(eq(schema.agents.id, A1)).get();

describe("applyAgentEdit, the project boundary", () => {
  it("404 on an unknown agent", async () => {
    const result = await applyAgentEdit("unknown", { browserAccess: true });
    assert.deepEqual(result, { ok: false, status: 404, error: "agent not found" });
  });

  it("refuses another project's repository, naming it", async () => {
    const result = await applyAgentEdit(A1, { repoNames: ["api", "other"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /other/);
    assert.equal(agent()?.repoNames, "[]");
  });

  it("refuses another project's rule", async () => {
    const result = await applyAgentEdit(A1, { ruleIds: ["rule-2"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /rule-2/);
  });

  it("refuses another project's secret", async () => {
    const result = await applyAgentEdit(A1, { envSecretNames: ["OTHER_TOKEN"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /OTHER_TOKEN/);
  });

  it("refuses another project's MCP server", async () => {
    const result = await applyAgentEdit(A1, { mcpServerIds: ["mcp-2"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /mcp-2/);
  });

  it("refuses another project's environment, and an unknown one", async () => {
    assert.equal((await applyAgentEdit(A1, { environmentId: "env-2" })).ok, false);
    assert.equal((await applyAgentEdit(A1, { environmentId: "never" })).ok, false);
    assert.equal(agent()?.environmentId, null);
  });

  it("refuses a skill the disk does not know", async () => {
    const result = await applyAgentEdit(A1, { skillNames: ["made-up-skill"] });
    assert.equal(result.ok, false);
    assert.match(result.error, /made-up-skill/);
  });

  it("accepts and writes grants from the same project", async () => {
    const result = await applyAgentEdit(A1, {
      repoNames: ["api"],
      ruleIds: ["rule-1"],
      envSecretNames: ["TOKEN"],
      mcpServerIds: ["mcp-1"],
      environmentId: "env-1",
    });
    assert.equal(result.ok, true);
    const row = agent();
    assert.deepEqual(JSON.parse(row?.repoNames ?? "[]"), ["api"]);
    assert.deepEqual(JSON.parse(row?.ruleIds ?? "[]"), ["rule-1"]);
    assert.deepEqual(JSON.parse(row?.envSecretNames ?? "[]"), ["TOKEN"]);
    assert.deepEqual(JSON.parse(row?.mcpServerIds ?? "[]"), ["mcp-1"]);
    assert.equal(row?.environmentId, "env-1");
  });

  it("`environmentId: null` removes the environment", async () => {
    await applyAgentEdit(A1, { environmentId: "env-1" });
    assert.equal((await applyAgentEdit(A1, { environmentId: null })).ok, true);
    assert.equal(agent()?.environmentId, null);
  });
});

describe("applyAgentEdit, validate everything then write everything", () => {
  it("writes nothing when one grant is valid and one is outside the project", async () => {
    const result = await applyAgentEdit(A1, { repoNames: ["api"], ruleIds: ["rule-2"] });
    assert.equal(result.ok, false);
    assert.equal(agent()?.repoNames, "[]");
    assert.equal(agent()?.ruleIds, "[]");
  });

  it("does not write a valid role alongside an out-of-project grant", async () => {
    const result = await applyAgentEdit(A1, { rolePrompt: "new", mcpServerIds: ["mcp-2"] });
    assert.equal(result.ok, false);
    assert.equal(agent()?.rolePrompt, "role");
  });

  it("refuses an empty body by name instead of succeeding silently", async () => {
    assert.deepEqual(await applyAgentEdit(A1, {}), {
      ok: false,
      status: 400,
      error: "nothing to change",
    });
  });

  it("writes plain settings as-is once past the schema", async () => {
    const result = await applyAgentEdit(A1, {
      model: "sonnet",
      repoAccess: "read",
      browserAccess: true,
      thinking: "enabled",
      thinkingBudget: 2048,
      runnerPreference: "mini-atelier",
    });
    assert.equal(result.ok, true);
    const row = agent();
    assert.equal(row?.model, "sonnet");
    assert.equal(row?.repoAccess, "read");
    assert.equal(row?.browserAccess, true);
    assert.equal(row?.thinking, "enabled");
    assert.equal(row?.thinkingBudget, 2048);
    assert.equal(row?.runnerPreference, "mini-atelier");
  });

  it("`runnerPreference: null` removes the preference", async () => {
    await applyAgentEdit(A1, { runnerPreference: "mini-atelier" });
    assert.equal((await applyAgentEdit(A1, { runnerPreference: null })).ok, true);
    assert.equal(agent()?.runnerPreference, null);
  });

  it("`model: null` puts the agent back on the project's default model", async () => {
    await applyAgentEdit(A1, { model: "sonnet" });
    assert.equal((await applyAgentEdit(A1, { model: null })).ok, true);
    assert.equal(agent()?.model, null);
  });
});

describe("applyAgentEdit, consistency between fields", () => {
  it("judges `allowedTools` against the MCP servers of the same patch", async () => {
    const result = await applyAgentEdit(A1, {
      mcpServerIds: ["mcp-1"],
      allowedTools: ["Bash", "mcp__github"],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(agent()?.allowedTools ?? "null"), ["Bash", "mcp__github"]);
  });

  it("refuses the same `allowedTools` without the server granted", async () => {
    const result = await applyAgentEdit(A1, { allowedTools: ["Bash", "mcp__github"] });
    assert.equal(result.ok, false);
    assert.equal(agent()?.allowedTools, null);
  });

  it("`inboxAccess` enabled in the same body requires the inbox tools in `allowedTools`; nothing is written on refusal", async () => {
    // A1 has `inboxAccess: false` in the fixture: judged against the old value, this patch would
    // be wrongly accepted.
    const result = await applyAgentEdit(A1, { inboxAccess: true, allowedTools: ["Bash"] });
    assert.equal(result.ok, false);
    assert.equal(agent()?.inboxAccess, false);
  });

  it("accepts `inboxAccess` with an `allowedTools` keeping the inbox tools in the same body", async () => {
    const result = await applyAgentEdit(A1, {
      inboxAccess: true,
      allowedTools: ["Bash", "mcp__legion__inbox_ask", "mcp__legion__inbox_send"],
    });
    assert.equal(result.ok, true);
    assert.equal(agent()?.inboxAccess, true);
  });
});
