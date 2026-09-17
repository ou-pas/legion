// Database access of `rule-edit-store.ts`, on a real temporary SQLite database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-rule-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { deleteRuleRow, getRule, insertRule, repoNamesOfProject, rulesOf, updateRule } =
  await import("./rule-edit-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.repos)
  .values({ id: "r-repo", projectId: "p1", name: "monorepo", url: "git@x", createdAt: now })
  .run();

describe("rule-edit-store", () => {
  it("returns a project's repository names", () => {
    assert.deepEqual(repoNamesOfProject("p1"), ["monorepo"]);
  });

  it("inserts, reads, lists, edits then deletes a rule", () => {
    insertRule({
      id: "rule1",
      projectId: "p1",
      name: "rule1",
      content: "c",
      allAgents: false,
      status: "active",
      summary: "",
      repoNames: "[]",
      locked: false,
      paths: "[]",
      createdAt: now,
    });
    assert.equal(getRule("rule1")?.name, "rule1");
    assert.equal(rulesOf("p1").length, 1);
    assert.equal(rulesOf(undefined).length, 1);

    updateRule("rule1", { content: "c2" });
    assert.equal(getRule("rule1")?.content, "c2");

    deleteRuleRow("rule1");
    assert.equal(getRule("rule1"), undefined);
  });
});
