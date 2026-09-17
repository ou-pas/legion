import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-seed-demo-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../../shared/db.js");
const {
  insertAgentRows,
  insertEnvironmentRows,
  insertGoalEventRows,
  insertGoalRows,
  insertInboxMessageRows,
  insertMcpServerRows,
  insertNoticeRows,
  insertProjectRow,
  insertRepoRows,
  insertRuleRows,
  insertRunnerRow,
  insertSessionEventRows,
  insertSessionRows,
  insertTaskActivityRows,
  insertTaskRows,
  insertTaskTemplateRow,
} = await import("./demo-store.js");
const { NETWORKING, RUNNER_KIND } = await import("../../shared/enums.js");

const now = new Date();

describe("seed-demo-store", () => {
  it("inserts each table of the decor", () => {
    insertRunnerRow({ id: "r1", name: "local", kind: RUNNER_KIND.docker, dockerHost: null });
    insertProjectRow({ id: "p1", name: "Demo", slug: "demo", createdAt: now });
    insertEnvironmentRows([
      { id: "e1", projectId: "p1", name: "open", networking: NETWORKING.open, allowedHosts: "[]" },
    ]);
    insertRepoRows([
      { id: "rp1", projectId: "p1", name: "front", url: "https://x/y.git", createdAt: now },
    ]);
    insertRuleRows([
      {
        id: "ru1",
        projectId: "p1",
        name: "conv",
        allAgents: true,
        status: "active",
        content: "c",
        createdAt: now,
      },
    ]);
    insertMcpServerRows([
      {
        id: "m1",
        projectId: "p1",
        name: "linear",
        allowedHosts: "[]",
        config: "{}",
        createdAt: now,
      },
    ]);
    insertAgentRows([
      {
        id: "a1",
        projectId: "p1",
        name: "senior-dev",
        title: "t",
        rolePrompt: "r",
        createdAt: now,
      },
    ]);
    insertTaskTemplateRow({
      id: "tt1",
      projectId: "p1",
      name: "compound-engineer",
      description: "d",
      steps: "[]",
      createdAt: now,
    });
    insertTaskRows([
      {
        id: "t1",
        projectId: "p1",
        name: "Task",
        status: "todo",
        boardOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    insertSessionRows([
      {
        id: "s1",
        taskId: "t1",
        agentId: "a1",
        runnerId: "r1",
        model: "m",
        callbackToken: "tok",
        status: "waiting",
        startedAt: now,
      },
    ]);
    insertSessionEventRows([{ sessionId: "s1", type: "status", payload: "{}", createdAt: now }]);
    insertInboxMessageRows([
      {
        id: "i1",
        sessionId: "s1",
        taskId: "t1",
        agentId: "a1",
        kind: "text",
        body: "b",
        createdAt: now,
      },
    ]);
    insertTaskActivityRows([
      { id: "act1", taskId: "t1", from: "agent", body: "b", createdAt: now },
    ]);
    insertGoalRows([
      { id: "g1", projectId: "p1", name: "goal", request: "r", status: "active", createdAt: now },
    ]);
    insertGoalEventRows([{ goalId: "g1", type: "status", payload: "{}", createdAt: now }]);
    insertNoticeRows([{ id: "n1", kind: "info", body: "b", createdAt: now }]);

    assert.equal(db.select().from(schema.runners).all().length, 1);
    assert.equal(db.select().from(schema.projects).all().length, 1);
    assert.equal(db.select().from(schema.environments).all().length, 1);
    assert.equal(db.select().from(schema.repos).all().length, 1);
    assert.equal(db.select().from(schema.rules).all().length, 1);
    assert.equal(db.select().from(schema.mcpServers).all().length, 1);
    assert.equal(db.select().from(schema.agents).all().length, 1);
    assert.equal(db.select().from(schema.taskTemplates).all().length, 1);
    assert.equal(db.select().from(schema.tasks).all().length, 1);
    assert.equal(db.select().from(schema.sessions).all().length, 1);
    assert.equal(db.select().from(schema.sessionEvents).all().length, 1);
    assert.equal(db.select().from(schema.inboxMessages).all().length, 1);
    assert.equal(db.select().from(schema.taskActivity).all().length, 1);
    assert.equal(db.select().from(schema.goals).all().length, 1);
    assert.equal(db.select().from(schema.goalEvents).all().length, 1);
    assert.equal(db.select().from(schema.notices).all().length, 1);
  });
});
