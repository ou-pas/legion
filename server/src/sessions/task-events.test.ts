// A task's full thread across sessions (Channels, follow-up of HSV_FFG00R); see task-events.ts's
// header for the past (this route) / present (existing SSE) split.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-task-events-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { publish } = await import("../shared/events.js");
const { listTaskEvents, listTaskSessions } = await import("./task-events.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";
const TASK = "t1";

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "agent",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: PROJECT,
      name: "task",
      status: TASK_STATUS.doing,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function newSession(id: string, opts: Partial<typeof schema.sessions.$inferInsert> = {}) {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: TASK,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: "running",
      callbackToken: `tok-${id}`,
      mock: true,
      sdkSessionId: `sdk-${id}`,
      startedAt: new Date(),
      ...opts,
    })
    .run();
}

describe("listTaskEvents: a task's thread across sessions", () => {
  beforeEach(() => reset());

  it("crosses SEVERAL sessions chronologically, with sessionId on each event", () => {
    newSession("s1");
    publish("s1", "text", { text: "first message" });
    publish("s1", "status", { status: "destroyed" });

    newSession("s2");
    publish("s2", "text", { text: "second session" });

    const page = listTaskEvents(TASK);
    assert.equal(page.events.length, 3);
    assert.deepEqual(
      page.events.map((e) => e.sessionId),
      ["s1", "s1", "s2"],
    );
    assert.equal(page.sessions.length, 2);
    assert.deepEqual(
      page.sessions.map((s) => s.id),
      ["s1", "s2"],
      "sessions in start order",
    );
  });

  it("since=<eventId> returns only what follows, like replay()", () => {
    newSession("s1");
    publish("s1", "text", { text: "a" });
    const [first] = listTaskEvents(TASK).events;
    publish("s1", "text", { text: "b" });
    publish("s1", "text", { text: "c" });

    const page = listTaskEvents(TASK, first!.dbId);
    assert.deepEqual(
      page.events.map((e) => (e.payload as { text: string }).text),
      ["b", "c"],
    );
    // Session bounds are still returned when `since` filters out all its events: the UI needs them to
    // label the break, not only to read new messages.
    assert.equal(page.sessions.length, 1);
  });

  it("does not mix tasks: filters strictly by taskId", () => {
    newSession("s1");
    publish("s1", "text", { text: "on t1" });
    db.insert(schema.tasks)
      .values({
        id: "t2",
        projectId: PROJECT,
        name: "other task",
        status: TASK_STATUS.doing,
        assigneeAgentId: AGENT,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    db.insert(schema.sessions)
      .values({
        id: "s2",
        taskId: "t2",
        agentId: AGENT,
        runnerId: RUNNER,
        model: "m",
        status: "running",
        callbackToken: "tok-t2",
        mock: true,
        sdkSessionId: "sdk-t2",
        startedAt: new Date(),
      })
      .run();
    publish("s2", "text", { text: "on t2" });

    assert.equal(listTaskEvents(TASK).events.length, 1);
    assert.equal(listTaskEvents("t2").events.length, 1);
  });

  it("task without session: empty lists, no error", () => {
    const page = listTaskEvents(TASK);
    assert.deepEqual(page, { sessions: [], events: [] });
  });

  it("listTaskSessions carries each session's status, bounds and endReason", () => {
    newSession("s1", { status: "failed", endedAt: new Date(2000), endReason: "timeout" });
    const [s] = listTaskSessions(TASK);
    assert.equal(s!.status, "failed");
    assert.equal(s!.endReason, "timeout");
    assert.equal(s!.endedAt, 2000);
  });
});
