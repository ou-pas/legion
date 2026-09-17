// A relaunched task keeps the decisions the operator gave its previous runs (08/09, task
// ziapYwNGKR):
//
//  - only HUMAN steers/answers from a session of THE task reach the block;
//  - the agent's question is dropped, only the human answer is kept;
//  - an automatic wake-up (`answeredBy: "system"`) is never mistaken for a decision;
//  - the block is bounded: past the ceiling, the most RECENT decisions stay, and the block says so;
//  - a task without human decisions gets NO section (no empty block).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-decisions-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { taskDecisionsBrief } = await import("./task-decisions.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { INBOX_KIND, INBOX_STATUS } = await import("../inbox/inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p1";
const A = "a1";
const R = "r1";
const T = "t1";

function reset() {
  const now = new Date();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: R, name: "r", kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: T,
      projectId: P,
      name: "t",
      status: TASK_STATUS.doing,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

let n = 0;
function newSession(taskId: string = T): string {
  const id = `s${++n}`;
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: A,
      runnerId: R,
      model: "m",
      status: "running",
      callbackToken: `tok-${id}`,
      startedAt: new Date(),
    })
    .run();
  return id;
}

function steer(sessionId: string, text: string, at: number, source = "human"): void {
  db.insert(schema.sessionSteers)
    .values({ id: `sr-${sessionId}-${at}`, sessionId, text, source, createdAt: new Date(at) })
    .run();
}

function inboxAnswer(
  sessionId: string,
  taskId: string,
  answerText: string,
  at: number,
  opts: { answeredBy?: "human" | "system"; body?: string } = {},
): void {
  const id = `ib-${sessionId}-${at}`;
  db.insert(schema.inboxMessages)
    .values({
      id,
      sessionId,
      taskId,
      agentId: A,
      kind: INBOX_KIND.text,
      body: opts.body ?? "agent's question",
      status: INBOX_STATUS.answered,
      answerText,
      answeredBy: opts.answeredBy ?? "human",
      answeredAt: new Date(at),
      createdAt: new Date(at - 1000),
    })
    .run();
}

describe("taskDecisionsBrief", () => {
  beforeEach(() => reset());

  it("no human decision: no section", () => {
    newSession();
    assert.equal(taskDecisionsBrief(T), null);
  });

  it("a human steer from a previous run reaches the next run's brief", () => {
    const s1 = newSession();
    steer(s1, "Narrow the scope to the backend only", 1000);
    const block = taskDecisionsBrief(T);
    assert.ok(block?.includes("Narrow the scope to the backend only"));
    assert.match(block!, /Operator decisions/);
  });

  it("a steer from ANOTHER task does not arrive", () => {
    db.insert(schema.tasks)
      .values({
        id: "t2",
        projectId: P,
        name: "other",
        status: TASK_STATUS.doing,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    const s1 = newSession();
    steer(s1, "steer from t1", 1000);
    const s2 = newSession("t2");
    steer(s2, "steer from t2, must not leak", 2000);

    const block = taskDecisionsBrief(T)!;
    assert.ok(block.includes("steer from t1"));
    assert.ok(!block.includes("steer from t2"));
  });

  it("a NON-human steer (different source) is not included", () => {
    const s1 = newSession();
    steer(s1, "message from a future orchestrator", 1000, "orchestrator");
    assert.equal(taskDecisionsBrief(T), null);
  });

  it("an answeredBy=system answer (quota wake-up) is not included", () => {
    const s1 = newSession();
    inboxAnswer(s1, T, "The quota is reset — pick up exactly where you left off.", 1000, {
      answeredBy: "system",
    });
    assert.equal(taskDecisionsBrief(T), null, "an automatic wake-up is not an operator decision");
  });

  it("keeps the answer, drops the question", () => {
    const s1 = newSession();
    inboxAnswer(s1, T, "Do X rather than Y", 1000, {
      body: "Should I do X or Y, given the tight budget?",
    });
    const block = taskDecisionsBrief(T)!;
    assert.ok(block.includes("Do X rather than Y"));
    assert.ok(
      !block.includes("Should I do X or Y"),
      "the agent's question must not come back into the brief",
    );
  });

  it("chronological order, steers and answers mixed, several sessions", () => {
    const s1 = newSession();
    steer(s1, "first", 1000);
    inboxAnswer(s1, T, "second", 2000);
    const s2 = newSession();
    steer(s2, "third", 3000);

    const block = taskDecisionsBrief(T)!;
    const [i1, i2, i3] = ["first", "second", "third"].map((t) => block.indexOf(t)) as [
      number,
      number,
      number,
    ];
    assert.ok(i1 >= 0 && i1 < i2 && i2 < i3, "chronological order expected, across sessions");
  });

  it("bound: past the ceiling, the most RECENT stay, and the block says it is truncated", () => {
    const s1 = newSession();
    const big = "x".repeat(1500);
    steer(s1, `${big}-one`, 1000);
    steer(s1, `${big}-two`, 2000);
    steer(s1, `${big}-three`, 3000);
    steer(s1, `${big}-four`, 4000);

    const block = taskDecisionsBrief(T)!;
    assert.ok(block.includes(`${big}-four`), "the most recent must be kept");
    assert.ok(!block.includes(`${big}-one`), "the oldest must be cut first");
    assert.match(block, /truncated/);
  });

  it("a single steer above the ceiling is not emptied", () => {
    const s1 = newSession();
    steer(s1, "y".repeat(5000), 1000);
    const block = taskDecisionsBrief(T)!;
    assert.ok(
      block.includes("y".repeat(5000)),
      "alone and recent, it stays: an empty block would be worse",
    );
  });
});
