// Talking to a task without a live session: refusals, the feed, and the safety net.
//
// The gesture comes from a real case (03/09): an agent returns its report with "follow-up to track
// separately (out of scope)", the session is dead, and there is nobody left to ask for details or
// to tell "file it".
//
// These tests mostly pin what the module refuses, because that is where it could do damage:
// rewriting a working agent's brief, or leaving a task in `todo` with a message nobody will read.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-message-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { ACTIVITY_FROM } = await import("./activity-enums.js");
const { sendTaskMessage, TASK_MESSAGE_MAX } = await import("./task-message.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";
const TASK = "t1";
const BRIEF = "The original brief.";

function seed(opts: { status?: string; assigned?: boolean; demo?: boolean } = {}): void {
  const now = new Date();
  db.delete(schema.taskActivity).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.runners).values({ id: RUNNER, name: "runner", kind: "docker" }).run();
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "P", slug: "p", demo: opts.demo ?? false, createdAt: now })
    .run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: PROJECT,
      name: "T",
      description: BRIEF,
      status: (opts.status ?? TASK_STATUS.done) as "done",
      assigneeAgentId: opts.assigned === false ? null : AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

const taskRow = () => db.select().from(schema.tasks).where(eq(schema.tasks.id, TASK)).get();
const activity = () => db.select().from(schema.taskActivity).all();

describe("sendTaskMessage: what it refuses", () => {
  beforeEach(() => seed());

  it("refuses an empty message", async () => {
    const r = await sendTaskMessage(TASK, "   ");
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 400);
  });

  it("refuses a message over the cap, giving both numbers", async () => {
    const r = await sendTaskMessage(TASK, "x".repeat(TASK_MESSAGE_MAX + 1));
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.error : "", new RegExp(String(TASK_MESSAGE_MAX)));
  });

  it("refuses a missing task", async () => {
    const r = await sendTaskMessage("unknown", "hello");
    assert.equal(r.ok === false && r.status, 404);
  });

  it("refuses a task without an agent: nobody would read the message", async () => {
    seed({ assigned: false });
    const r = await sendTaskMessage(TASK, "a detail?");
    assert.equal(r.ok === false && r.status, 409);
    assert.match(r.ok === false ? r.error : "", /no agent assigned/);
  });

  it("refuses a demo project", async () => {
    seed({ demo: true });
    assert.equal((await sendTaskMessage(TASK, "hello")).ok, false);
  });

  // The refusal preventing damage: rewriting the brief under a working agent. The message points to
  // steering, which talks to the runtime without restarting it.
  it("refuses when a session is working, and points to steering", async () => {
    seed({ status: TASK_STATUS.doing });
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId: TASK,
        agentId: AGENT,
        runnerId: RUNNER,
        model: "haiku",
        status: SESSION_STATUS.running,
        callbackToken: "tok",
        startedAt: new Date(),
      })
      .run();
    const r = await sendTaskMessage(TASK, "changed my mind");
    assert.equal(r.ok === false && r.status, 409);
    assert.match(r.ok === false ? r.error : "", /steering/);
    assert.equal(taskRow()?.description, BRIEF, "the brief did not move");
    assert.equal(activity().length, 0, "and nothing entered the feed");
  });

  // A paused session is alive too (`ACTIVE_STATUSES`): it will resume, and its brief already left in
  // its container.
  it("also refuses on a waiting session, not only a running one", async () => {
    seed({ status: TASK_STATUS.doing });
    db.insert(schema.sessions)
      .values({
        id: "s1",
        taskId: TASK,
        agentId: AGENT,
        runnerId: RUNNER,
        model: "haiku",
        status: SESSION_STATUS.waiting,
        callbackToken: "tok",
        startedAt: new Date(),
      })
      .run();
    assert.equal((await sendTaskMessage(TASK, "hello")).ok, false);
  });
});

describe("sendTaskMessage: the safety net", () => {
  beforeEach(() => seed());

  // Without a reachable runner, `runTask` throws. The task must go back where it came from: leaving
  // it in `todo` with a message added to the brief would give the illusion of having spoken.
  it("restores the state when the rerun fails: original brief and status", async () => {
    const r = await sendTaskMessage(TASK, "a detail on the out-of-scope part?");
    assert.equal(r.ok, false, "no runtime in this test: the rerun fails");
    assert.equal(taskRow()?.description, BRIEF, "the brief is restored");
    assert.equal(taskRow()?.status, TASK_STATUS.done, "and so is the status");
  });

  // But the message was written: the two facts are distinct, and the feed keeps it.
  it("keeps the message in the activity feed despite the failed rerun", async () => {
    await sendTaskMessage(TASK, "file the follow-up task");
    const rows = activity();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.from, ACTIVITY_FROM.human);
    assert.equal(rows[0]?.body, "file the follow-up task");
  });
});
