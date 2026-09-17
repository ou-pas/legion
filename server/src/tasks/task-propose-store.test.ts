// Session and origin task, project agent names, the session's existing filings, and the
// transactional insert of the filed task with its blockers. Real temporary SQLite, like its domain
// neighbours.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-propose-store-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { findSessionRow, findTaskRow, insertProposedTask, projectAgentNames, sessionDepositIds } =
  await import("./task-propose-store.js");
const { blockersOf } = await import("./blockers-store.js");
const { TASK_STATUS } = await import("./lifecycle.js");

const P = "p1";
const now = new Date();
db.insert(schema.projects).values({ id: P, name: "P", slug: "p1", createdAt: now }).run();
db.insert(schema.agents)
  .values([
    { id: "a1", projectId: P, name: "build", rolePrompt: "r", createdAt: now },
    { id: "a2", projectId: P, name: "review", rolePrompt: "r", createdAt: now },
  ])
  .run();
db.insert(schema.runners).values({ id: "r1", name: "mini", kind: "process" }).run();
db.insert(schema.tasks)
  .values([
    {
      id: "origin",
      projectId: P,
      name: "origin",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "existing-blocker",
      projectId: P,
      name: "already blocked",
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();
db.insert(schema.sessions)
  .values({
    id: "s1",
    taskId: "origin",
    agentId: "a1",
    runnerId: "r1",
    model: "sonnet",
    status: "running",
    callbackToken: "tok",
    startedAt: now,
  })
  .run();
db.insert(schema.tasks)
  .values({
    id: "already-deposited",
    projectId: P,
    name: "already filed",
    status: TASK_STATUS.later,
    proposedBySessionId: "s1",
    createdAt: now,
    updatedAt: now,
  })
  .run();

describe("findSessionRow / findTaskRow", () => {
  it("return the row, or undefined", () => {
    assert.equal(findSessionRow("s1")?.taskId, "origin");
    assert.equal(findSessionRow("never-seen"), undefined);
    assert.equal(findTaskRow("origin")?.name, "origin");
    assert.equal(findTaskRow("never-seen"), undefined);
  });
});

describe("projectAgentNames", () => {
  it("returns the project's agent names, in their written case", () => {
    assert.deepEqual(projectAgentNames(P).sort(), ["build", "review"]);
    assert.deepEqual(projectAgentNames("ghost-project"), []);
  });
});

describe("sessionDepositIds", () => {
  it("returns the ids already filed by this session", () => {
    assert.deepEqual(sessionDepositIds("s1"), ["already-deposited"]);
    assert.deepEqual(sessionDepositIds("s-ghost"), []);
  });
});

describe("insertProposedTask", () => {
  it("inserts the task with its declared blockers", () => {
    const created = insertProposedTask(
      {
        id: "deposit-1",
        projectId: P,
        name: "filing",
        status: TASK_STATUS.later,
        proposedBySessionId: "s1",
        createdAt: now,
        updatedAt: now,
      },
      ["existing-blocker"],
      null,
    );
    assert.equal(created.id, "deposit-1");
    assert.deepEqual(blockersOf("deposit-1"), ["existing-blocker"]);
  });

  it("blocks the origin task when `blockOriginId` is given (blocking behaviour)", () => {
    insertProposedTask(
      {
        id: "deposit-2",
        projectId: P,
        name: "blocking filing",
        status: TASK_STATUS.later,
        proposedBySessionId: "s1",
        createdAt: now,
        updatedAt: now,
      },
      [],
      "origin",
    );
    assert.deepEqual(blockersOf("origin"), ["deposit-2"]);
  });
});
