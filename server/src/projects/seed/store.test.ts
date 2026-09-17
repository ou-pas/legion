import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-seed-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const {
  agentRowExistsByName,
  hasAnyEnvironmentRow,
  hasAnyProjectRow,
  hasAnyRunner,
  hasAnyTemplateRow,
  insertAgentRow,
  insertEnvironmentRow,
  insertProjectRow,
  insertRunnerRow,
  insertTaskTemplateRow,
  setAgentFsGrants,
  ungrantedAgentRows,
} = await import("./store.js");
const { NETWORKING, RUNNER_KIND } = await import("../../shared/enums.js");

const now = new Date();

describe("seed-store", () => {
  it("hasAnyRunner and insertRunnerRow", () => {
    assert.equal(hasAnyRunner(), false);
    insertRunnerRow({ id: "r1", name: "local", kind: RUNNER_KIND.docker, dockerHost: null });
    assert.equal(hasAnyRunner(), true);
  });

  it("hasAnyProjectRow, insertProjectRow", () => {
    assert.equal(hasAnyProjectRow(), false);
    insertProjectRow({ id: "p1", name: "Default", slug: "default", createdAt: now });
    assert.equal(hasAnyProjectRow(), true);
  });

  it("ungrantedAgentRows and setAgentFsGrants", () => {
    insertAgentRow({
      id: "a1",
      projectId: "p1",
      name: "default",
      title: "t",
      rolePrompt: "r",
      fsGrants: "[]",
      createdAt: now,
    });
    const ungranted = ungrantedAgentRows();
    assert.equal(ungranted.length, 1);
    setAgentFsGrants("a1", JSON.stringify([{ folderPath: "/agents/default" }]));
    assert.equal(ungrantedAgentRows().length, 0);
  });

  it("agentRowExistsByName is scoped to the project", () => {
    assert.equal(agentRowExistsByName("default", "p1"), true);
    assert.equal(agentRowExistsByName("default", "other-project"), false);
  });

  it("hasAnyEnvironmentRow, insertEnvironmentRow", () => {
    assert.equal(hasAnyEnvironmentRow(), false);
    insertEnvironmentRow({
      id: "e1",
      projectId: "p1",
      name: "open",
      networking: NETWORKING.open,
      allowedHosts: "[]",
    });
    assert.equal(hasAnyEnvironmentRow(), true);
  });

  it("hasAnyTemplateRow, insertTaskTemplateRow", () => {
    assert.equal(hasAnyTemplateRow(), false);
    insertTaskTemplateRow({
      id: "tt1",
      projectId: "p1",
      name: "compound-engineer",
      description: "d",
      steps: "[]",
      createdAt: now,
    });
    assert.equal(hasAnyTemplateRow(), true);
    assert.equal(db.select().from(schema.taskTemplates).all().length, 1);
  });
});
