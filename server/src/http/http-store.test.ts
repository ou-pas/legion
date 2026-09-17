// Checks the reads hit four distinct tables; the order `lookupId` tries them in is tested next door.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-http-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  agentRow,
  allAgents,
  allProjects,
  allRunners,
  allTaskTemplates,
  goalRow,
  projectRow,
  taskRow,
} = await import("./http-store.js");

const now = new Date();
db.insert(schema.projects).values({ id: "p1", name: "P1", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: "p1", name: "dev", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.runners).values({ id: "r1", name: "local", kind: "docker" }).run();
db.insert(schema.taskTemplates)
  .values({
    id: "tpl1",
    projectId: "p1",
    name: "chain",
    description: "",
    steps: '[{"agentRole":"dev"}]',
    createdAt: now,
  })
  .run();
db.insert(schema.tasks)
  .values({
    id: "t1",
    projectId: "p1",
    name: "T1",
    status: "todo",
    boardOrder: 0,
    createdAt: now,
    updatedAt: now,
  })
  .run();
db.insert(schema.goals)
  .values({
    id: "g1",
    projectId: "p1",
    name: "goal",
    request: "do X",
    status: "draft",
    createdAt: now,
  })
  .run();

describe("http-store: the startup base", () => {
  it("returns the four lists the screen loads on first render", () => {
    assert.deepEqual(
      allProjects().map((p) => p.slug),
      ["p1"],
    );
    assert.deepEqual(
      allAgents().map((a) => a.name),
      ["dev"],
    );
    assert.deepEqual(
      allRunners().map((r) => r.name),
      ["local"],
    );
    assert.equal(allTaskTemplates().length, 1);
  });

  it("returns a template's steps as stored: the caller parses the JSON", () => {
    assert.equal(allTaskTemplates()[0]!.steps, '[{"agentRole":"dev"}]');
  });
});

describe("http-store: what an id designates", () => {
  it("finds a task, a goal, an agent and a project by id", () => {
    assert.equal(taskRow("t1")?.name, "T1");
    assert.equal(goalRow("g1")?.name, "goal");
    assert.equal(agentRow("a1")?.name, "dev");
    assert.equal(projectRow("p1")?.name, "P1");
  });

  it("an unknown id returns nothing, in all four tables", () => {
    assert.equal(taskRow("zz"), undefined);
    assert.equal(goalRow("zz"), undefined);
    assert.equal(agentRow("zz"), undefined);
    assert.equal(projectRow("zz"), undefined);
  });
});
