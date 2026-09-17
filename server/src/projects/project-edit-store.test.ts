import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-project-edit-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { agentRowsOfProject, projectRowById, slugTaken, updateProjectRow } =
  await import("./project-edit-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "a1", rolePrompt: "r", createdAt: now })
  .run();

describe("project-edit-store", () => {
  it("projectRowById reads an existing row, undefined otherwise", () => {
    assert.equal(projectRowById("p1")?.name, "P1");
    assert.equal(projectRowById("nope"), undefined);
  });

  it("slugTaken tells a taken slug from a free one", () => {
    assert.equal(slugTaken("p1"), true);
    assert.equal(slugTaken("free"), false);
  });

  it("agentRowsOfProject filters by project", () => {
    assert.equal(agentRowsOfProject("p1").length, 1);
    assert.equal(agentRowsOfProject("nope").length, 0);
  });

  it("updateProjectRow writes the patch", () => {
    updateProjectRow("p1", { hue: 42 });
    assert.equal(projectRowById("p1")?.hue, 42);
  });
});
