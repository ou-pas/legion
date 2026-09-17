import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-repo-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentRowsOfProject,
  deleteRepoRow,
  insertRepoRow,
  projectExists,
  repoRowById,
  repoRowsOfProject,
  updateAgentRepoNames,
  updateRepoRow,
  withTransaction,
} = await import("./repo-edit-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({
    id: "a1",
    projectId: "p1",
    name: "a1",
    rolePrompt: "r",
    repoNames: JSON.stringify(["main"]),
    createdAt: now,
  })
  .run();

describe("repo-edit-store", () => {
  it("projectExists tells a real project from an unknown id", () => {
    assert.equal(projectExists("p1"), true);
    assert.equal(projectExists("nope"), false);
  });

  it("inserts a repository and reads it back by id and by project", () => {
    insertRepoRow({
      id: "r1",
      projectId: "p1",
      name: "main",
      url: "https://x/y.git",
      createdAt: now,
    });
    assert.equal(repoRowById("r1")?.name, "main");
    assert.equal(repoRowsOfProject("p1").length, 1);
  });

  it("updates a repository", () => {
    updateRepoRow("r1", { testCommand: "pnpm test" });
    assert.equal(repoRowById("r1")?.testCommand, "pnpm test");
  });

  it("lists a project's agents and rewrites their repoNames", () => {
    assert.equal(agentRowsOfProject("p1").length, 1);
    updateAgentRepoNames("a1", JSON.stringify([]));
    assert.equal(agentRowsOfProject("p1")[0]?.repoNames, "[]");
  });

  it("deletes a repository in a transaction", () => {
    withTransaction(() => deleteRepoRow("r1"));
    assert.equal(repoRowById("r1"), undefined);
  });
});
