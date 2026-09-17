import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-seed-self-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const {
  agentNamesOfProject,
  agentRowByName,
  environmentRowByName,
  insertAgentRow,
  insertEnvironmentRow,
  insertProjectRow,
  insertRepoRow,
  insertRuleRow,
  projectRowBySlug,
  repoRowByName,
  ruleRowByName,
  updateAgentRow,
  updateEnvironmentRow,
  updateProjectRow,
  updateRepoRow,
  updateRuleRow,
} = await import("./self-store.js");
const { NETWORKING } = await import("../../shared/enums.js");

const now = new Date();

describe("seed-self-store", () => {
  it("project: missing, then inserted, then updated", () => {
    assert.equal(projectRowBySlug("legion"), undefined);
    insertProjectRow({ id: "p1", name: "Legion", slug: "legion", createdAt: now });
    assert.equal(projectRowBySlug("legion")?.id, "p1");
    updateProjectRow("p1", { name: "Legion!" });
    assert.equal(projectRowBySlug("legion")?.name, "Legion!");
  });

  it("environment: by name, inserted then updated", () => {
    assert.equal(environmentRowByName("p1", "open"), undefined);
    insertEnvironmentRow({
      id: "e1",
      projectId: "p1",
      name: "open",
      networking: NETWORKING.open,
      allowedHosts: "[]",
    });
    assert.equal(environmentRowByName("p1", "open")?.id, "e1");
    updateEnvironmentRow("e1", { allowedHosts: JSON.stringify(["github.com"]) });
    assert.equal(environmentRowByName("p1", "open")?.allowedHosts, JSON.stringify(["github.com"]));
  });

  it("repository: by name, inserted then updated", () => {
    assert.equal(repoRowByName("p1", "legion"), undefined);
    insertRepoRow({
      id: "r1",
      projectId: "p1",
      name: "legion",
      url: "https://x/y.git",
      createdAt: now,
    });
    assert.equal(repoRowByName("p1", "legion")?.id, "r1");
    updateRepoRow("r1", { forge: "github" });
    assert.equal(repoRowByName("p1", "legion")?.forge, "github");
  });

  it("rule: by name, inserted then updated", () => {
    assert.equal(ruleRowByName("p1", "regle-x"), undefined);
    insertRuleRow({
      id: "rl1",
      projectId: "p1",
      name: "regle-x",
      content: "c",
      allAgents: true,
      status: "active",
      createdAt: now,
    });
    assert.equal(ruleRowByName("p1", "regle-x")?.id, "rl1");
    updateRuleRow("rl1", { content: "c2" });
    assert.equal(ruleRowByName("p1", "regle-x")?.content, "c2");
  });

  it("agent: by name, inserted, updated, listed by name", () => {
    assert.equal(agentRowByName("p1", "server"), undefined);
    insertAgentRow({
      id: "ag1",
      projectId: "p1",
      name: "server",
      title: "t",
      rolePrompt: "r",
      createdAt: now,
    });
    assert.equal(agentRowByName("p1", "server")?.id, "ag1");
    updateAgentRow("ag1", { title: "t2" });
    assert.equal(agentRowByName("p1", "server")?.title, "t2");
    assert.deepEqual(agentNamesOfProject("p1"), ["server"]);
  });
});
