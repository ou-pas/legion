// Real database in a temporary file: the read crosses tasks, sessions, agents, projects and
// inbox_messages, and an in-memory fake would prove nothing about the real join.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-concierge-ctx-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { fetchConciergeContext } = await import("./concierge-context.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P1 = "p1",
  P2 = "p2",
  A1 = "a1",
  R1 = "r1";
const NOW = new Date("2026-08-26T12:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

before(() => {
  db.insert(schema.projects)
    .values([
      { id: P1, name: "Project A", slug: "a", createdAt: NOW },
      { id: P2, name: "Project B", slug: "b", createdAt: NOW },
    ])
    .run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "senior-dev", rolePrompt: "r", createdAt: NOW })
    .run();
  db.insert(schema.runners).values({ id: R1, name: "local", kind: RUNNER_KIND.process }).run();

  db.insert(schema.tasks)
    .values([
      {
        id: "t-old",
        projectId: P1,
        name: "Old task",
        status: TASK_STATUS.done,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(30),
      },
      {
        id: "t-new",
        projectId: P2,
        name: "Recent task",
        status: TASK_STATUS.doing,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])
    .run();

  // One session inside the 7-day cost window and one outside, which must count neither in the
  // total nor in the displayed list.
  db.insert(schema.sessions)
    .values([
      {
        id: "s-recent",
        taskId: "t-new",
        agentId: A1,
        runnerId: R1,
        model: "sonnet",
        status: "running",
        callbackToken: "x",
        costUsd: 3.5,
        startedAt: daysAgo(1),
        endedAt: null,
      },
      {
        id: "s-old",
        taskId: "t-old",
        agentId: A1,
        runnerId: R1,
        model: "haiku",
        status: "destroyed",
        callbackToken: "x",
        costUsd: 99,
        startedAt: daysAgo(20),
        endedAt: daysAgo(20),
      },
    ])
    .run();

  db.insert(schema.inboxMessages)
    .values({
      id: "q1",
      sessionId: "s-recent",
      taskId: "t-new",
      agentId: A1,
      kind: "text",
      body: "which button style?",
      status: "open",
      createdAt: daysAgo(1),
    })
    .run();
  // An answered question must never appear.
  db.insert(schema.inboxMessages)
    .values({
      id: "q2",
      sessionId: "s-old",
      taskId: "t-old",
      agentId: A1,
      kind: "text",
      body: "old question, already answered",
      status: "answered",
      createdAt: daysAgo(20),
      answeredAt: daysAgo(20),
    })
    .run();
});

describe("fetchConciergeContext", () => {
  it("spans every project: the concierge belongs to none", () => {
    const ctx = fetchConciergeContext(NOW);
    const names = ctx.tasks.map((t) => t.projectName);
    assert.ok(names.includes("Project A"));
    assert.ok(names.includes("Project B"));
  });

  it("sorts recent tasks by last update, newest first", () => {
    const ctx = fetchConciergeContext(NOW);
    assert.equal(ctx.tasks[0]?.name, "Recent task");
  });

  it("counts cost only within the 7-day window: a 20-day-old session is left out", () => {
    const ctx = fetchConciergeContext(NOW);
    assert.equal(ctx.cost.totalUsd, 3.5);
    assert.equal(ctx.cost.windowDays, 7);
  });

  it("bounds displayed sessions to the same window as the cost", () => {
    const ctx = fetchConciergeContext(NOW);
    assert.equal(ctx.sessions.length, 1);
    assert.equal(ctx.sessions[0]?.taskName, "Recent task");
    assert.equal(ctx.sessions[0]?.agentName, "senior-dev");
  });

  it("counts running sessions in the window", () => {
    const ctx = fetchConciergeContext(NOW);
    assert.equal(ctx.cost.runningCount, 1);
  });

  it("returns only open inbox questions", () => {
    const ctx = fetchConciergeContext(NOW);
    assert.equal(ctx.pendingQuestions.length, 1);
    assert.equal(ctx.pendingQuestions[0]?.body, "which button style?");
  });

  it("is deterministic for a given `now`: no internal wall-clock call", () => {
    assert.deepEqual(fetchConciergeContext(NOW), fetchConciergeContext(NOW));
  });
});
