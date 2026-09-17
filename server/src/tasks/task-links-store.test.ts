// Raw queries: task by id, a task's children (newest first), and the two ways to find an agent.
// Assembling `TaskLink`/`TaskLinks` (resolved agent, derived `blocksParent`) is tested in
// `task-links.test.ts`. Real temporary SQLite, like its domain neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-links-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { agentRowById, agentRowByProjectAndName, childrenOf, taskRowById } =
  await import("./task-links-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values({ id: "a1", projectId: P, name: "build", rolePrompt: "r", createdAt: now })
  .run();
db.insert(schema.tasks)
  .values([
    {
      id: "root",
      projectId: P,
      name: "root",
      status: TASK_STATUS.doing,
      assigneeAgentId: "a1",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "child1",
      projectId: P,
      name: "child 1",
      status: TASK_STATUS.later,
      proposedFromTaskId: "root",
      createdAt: new Date(now.getTime() + 1000),
      updatedAt: now,
    },
    {
      id: "child2",
      projectId: P,
      name: "child 2",
      status: TASK_STATUS.later,
      proposedFromTaskId: "root",
      createdAt: new Date(now.getTime() + 2000),
      updatedAt: now,
    },
  ])
  .run();

describe("taskRowById", () => {
  it("returns the row, or undefined", () => {
    assert.equal(taskRowById("root")?.name, "root");
    assert.equal(taskRowById("never-seen"), undefined);
  });
});

describe("childrenOf", () => {
  it("returns the children, newest first", () => {
    assert.deepEqual(
      childrenOf("root").map((r) => r.id),
      ["child2", "child1"],
    );
    assert.deepEqual(childrenOf("child1"), []);
  });
});

describe("agentRowById / agentRowByProjectAndName", () => {
  it("returns the agent by id, or undefined", () => {
    assert.equal(agentRowById("a1")?.name, "build");
    assert.equal(agentRowById("never-seen"), undefined);
  });

  it("returns the agent by project + name, or undefined if the name does not exist (or is in another project)", () => {
    assert.equal(agentRowByProjectAndName(P, "build")?.id, "a1");
    assert.equal(agentRowByProjectAndName(P, "unknown"), undefined);
    assert.equal(agentRowByProjectAndName("other-project", "build"), undefined);
  });
});
