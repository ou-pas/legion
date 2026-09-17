import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-demo-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { insertDemoProject, projectBySlug } = await import("./demo-store.js");
const { NETWORKING } = await import("../shared/enums.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

const now = new Date();

describe("demo-store", () => {
  it("finds nothing before insertion", () => {
    assert.equal(projectBySlug("demonstration"), undefined);
  });

  it("inserts the project, its environment, agent and tasks", () => {
    insertDemoProject({
      project: { id: "p1", name: "Demo", slug: "demonstration", demo: true, createdAt: now },
      environment: {
        id: "e1",
        projectId: "p1",
        name: "open",
        networking: NETWORKING.open,
        allowedHosts: "[]",
      },
      agent: {
        id: "a1",
        projectId: "p1",
        name: "senior-dev",
        title: "Developer",
        environmentId: "e1",
        rolePrompt: "r",
        fsGrants: "[]",
        createdAt: now,
      },
      tasks: [
        {
          id: "t1",
          projectId: "p1",
          name: "Demo task",
          description: "d",
          status: TASK_STATUS.todo,
          boardOrder: 0,
          assigneeAgentId: "a1",
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    assert.equal(projectBySlug("demonstration")?.id, "p1");
    assert.equal(db.select().from(schema.tasks).all().length, 1);
    assert.equal(db.select().from(schema.agents).all().length, 1);
  });
});
