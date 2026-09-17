// Project-level capabilities (v35), and above all what will never be one.
//
// The dividing line: a capability adds an ability (skill, tool, instruction) and may have a
// project default; an access opens data (secret, repository) and stays ticked per agent.
// Confusing them would cancel least privilege.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-defaults-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const { resolveSkillNames, resolveMcpServers, resolveRules, SKILLS_DIR } =
  await import("./capabilities.js");
const { RULE_STATUS } = await import("./agent/agent-enums.js");

const PROJECT = "p-def";

/** A skill is a folder, not a row: the whole argument for storing the default on the project. */
function makeSkill(name: string): void {
  mkdirSync(join(SKILLS_DIR, name), { recursive: true });
  writeFileSync(
    join(SKILLS_DIR, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: test\n---\n# ${name}\n`,
  );
}

function reset(defaults: string[] = []): void {
  db.delete(schema.mcpServers).where(eq(schema.mcpServers.projectId, PROJECT)).run();
  db.delete(schema.rules).where(eq(schema.rules.projectId, PROJECT)).run();
  db.delete(schema.projects).where(eq(schema.projects.id, PROJECT)).run();
  db.insert(schema.projects)
    .values({
      id: PROJECT,
      name: "Defaults",
      slug: "defaults",
      defaultModel: "sonnet",
      defaultSkillNames: JSON.stringify(defaults),
      createdAt: new Date(),
    })
    .run();
}

const agent = (skills: string[] = [], mcp: string[] = [], repos: string[] = []) => ({
  skillNames: JSON.stringify(skills),
  mcpServerIds: JSON.stringify(mcp),
  ruleIds: "[]",
  repoNames: JSON.stringify(repos),
});

describe("skills, the project default adds to the agent's own", () => {
  beforeEach(() => reset(["lean-ctx"]));

  it("gives an agent without skills the project's", () => {
    assert.deepEqual(resolveSkillNames(agent(), PROJECT), ["lean-ctx"]);
  });

  it("keeps the agent's own too: additive, not a replacement", () => {
    // The motivating case: lean-ctx for everyone, impeccable for the front end only.
    assert.deepEqual(resolveSkillNames(agent(["impeccable"]), PROJECT), ["lean-ctx", "impeccable"]);
  });

  it("ships a skill ticked on both sides only once", () => {
    assert.deepEqual(resolveSkillNames(agent(["lean-ctx"]), PROJECT), ["lean-ctx"]);
  });

  it("changes nothing for a project without defaults", () => {
    reset([]);
    assert.deepEqual(resolveSkillNames(agent(["impeccable"]), PROJECT), ["impeccable"]);
  });

  it("does not break the session on an unreadable stored value", () => {
    // A corrupt default must degrade to no default, never throw: every session start goes here.
    db.update(schema.projects)
      .set({ defaultSkillNames: "{not json" })
      .where(eq(schema.projects.id, PROJECT))
      .run();
    assert.deepEqual(resolveSkillNames(agent(["impeccable"]), PROJECT), ["impeccable"]);
  });
});

describe("MCP servers, the same checkbox as rules", () => {
  beforeEach(() => {
    reset();
    const base = {
      projectId: PROJECT,
      config: JSON.stringify({ type: "stdio", command: "x" }),
      allowedHosts: "[]",
      createdAt: new Date(),
    };
    db.insert(schema.mcpServers)
      .values([
        { ...base, id: "m-everywhere", name: "everywhere", allAgents: true },
        { ...base, id: "m-tickable", name: "tickable", allAgents: false },
      ])
      .run();
  });

  it('brings an "all agents" server without ticking it', () => {
    const { names } = resolveMcpServers(agent(), PROJECT);
    assert.deepEqual(names, ["everywhere"]);
  });

  it("adds it to the one the agent ticked", () => {
    const { names } = resolveMcpServers(agent([], ["m-tickable"]), PROJECT);
    assert.deepEqual(names.sort(), ["everywhere", "tickable"]);
  });

  it("leaves out a server neither ticked nor default", () => {
    const { names } = resolveMcpServers(agent(), PROJECT);
    assert.ok(!names.includes("tickable"));
  });
});

describe("the dividing line: what will never have a project default", () => {
  it("keeps secrets and repositories as agent fields, not project ones", () => {
    // This locks a boundary. Whoever adds `projects.default_secret_names` for the convenience that
    // justified `default_skill_names` will land here: a skill adds an ability, a secret opens
    // data, and least privilege does not survive the latter.
    const columns = Object.keys(schema.projects);
    for (const forbidden of ["defaultSecretNames", "defaultRepoNames", "defaultEnvSecretNames"])
      assert.ok(
        !columns.includes(forbidden),
        `"${forbidden}": an access is not granted by default to a whole project`,
      );
    // The counterpart: both exist on the agent.
    const agentColumns = Object.keys(schema.agents);
    assert.ok(agentColumns.includes("envSecretNames"));
    assert.ok(agentColumns.includes("repoNames"));
  });

  it("resolves the three additive capabilities the same way", () => {
    // Rules, skills, MCP: same gesture, same additive meaning, or "all agents" would stop meaning
    // one thing.
    reset(["lean-ctx"]);
    db.insert(schema.rules)
      .values({
        id: "r-everywhere",
        projectId: PROJECT,
        name: "caveman",
        content: "terse",
        allAgents: true,
        status: RULE_STATUS.active,
        createdAt: new Date(),
      })
      .run();
    db.insert(schema.mcpServers)
      .values({
        id: "m2",
        projectId: PROJECT,
        name: "everywhere",
        config: JSON.stringify({ type: "stdio", command: "x" }),
        allowedHosts: "[]",
        allAgents: true,
        createdAt: new Date(),
      })
      .run();
    const a = agent(["impeccable"]);
    assert.deepEqual(resolveSkillNames(a, PROJECT), ["lean-ctx", "impeccable"]);
    assert.deepEqual(
      resolveRules(a, PROJECT).map((r) => r.name),
      ["caveman"],
    );
    assert.deepEqual(resolveMcpServers(a, PROJECT).names, ["everywhere"]);
  });
});

// `resolveSkillNames` reads only the database; the folders are there for `packSkills`.
makeSkill("lean-ctx");
makeSkill("impeccable");
