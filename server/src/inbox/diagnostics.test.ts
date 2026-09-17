// Failure diagnostic expiry (0JMcKrp7vg, 23/08):
//
//  1. A diagnostic expires when the task is rerun another way; offering it again would start a
//     parallel session. Closed with a system activity trace, never silently.
//  2. A late answer is refused naming both sessions, with nothing written before the check.
//  3. Only diagnostics expire: a real question (`onAnswer: resume`) holds a live session.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "../sessions/session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-diag-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { answerInbox } = await import("./inbox.js");
const { expireStaleDiagnostics } = await import("./diagnostics.js");
const { runTask } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { INBOX_STATUS, INBOX_KIND, ON_ANSWER, ANSWERED_BY } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

type Spec = import("../sessions/runner/types.js").SessionSpec;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => ({ id: spec.sessionId, runtime: "fake" }),
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.taskActivity).run();
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
}

function makeTask(id: string) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.review,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function makeSession(
  id: string,
  taskId: string,
  startedAt: Date,
  status: SessionStatus = "failed",
) {
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status,
      callbackToken: "tok",
      mock: true,
      sdkSessionId: "sdk",
      startedAt,
    })
    .run();
}

function makeDiagnostic(id: string, taskId: string, sessionId: string) {
  db.insert(schema.inboxMessages)
    .values({
      id,
      sessionId,
      taskId,
      agentId: AGENT,
      kind: INBOX_KIND.choice,
      body: "The session failed: run again?",
      choices: JSON.stringify([
        { id: "retry", label: "Run again" },
        { id: "drop", label: "Leave it" },
      ]),
      status: INBOX_STATUS.open,
      onAnswer: ON_ANSWER.retryTask,
      createdAt: new Date(),
    })
    .run();
}

const inboxRow = (id: string) =>
  db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, id)).get()!;
const activity = (taskId: string) =>
  db.select().from(schema.taskActivity).where(eq(schema.taskActivity.taskId, taskId)).all();

/** Waits for a consequence, bounded: the budget is when a failure beats a hanging test. */
async function until(cond: () => boolean, budgetMs = 2_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!cond() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
}

describe("expireStaleDiagnostics", () => {
  beforeEach(() => reset());

  it("a new session closes the old session's diagnostic, with a system trace", () => {
    makeTask("t1");
    makeSession("s-old", "t1", new Date(Date.now() - 60_000));
    makeDiagnostic("d1", "t1", "s-old");
    expireStaleDiagnostics("t1", "s-new");
    assert.equal(inboxRow("d1").status, INBOX_STATUS.closed);
    const trace = activity("t1");
    assert.equal(trace.length, 1);
    assert.equal(trace[0]?.from, ANSWERED_BY.system);
    assert.ok(trace[0]?.body.includes("Stale"));
  });

  it("leaves the new session's own diagnostic alone", () => {
    makeTask("t1");
    makeSession("s1", "t1", new Date());
    makeDiagnostic("d1", "t1", "s1");
    expireStaleDiagnostics("t1", "s1");
    assert.equal(inboxRow("d1").status, INBOX_STATUS.open);
  });

  it("never expires a real question (onAnswer: resume)", () => {
    makeTask("t1");
    makeSession("s-old", "t1", new Date(Date.now() - 60_000), SESSION_STATUS.waiting);
    db.insert(schema.inboxMessages)
      .values({
        id: "q1",
        sessionId: "s-old",
        taskId: "t1",
        agentId: AGENT,
        kind: INBOX_KIND.text,
        body: "real question",
        status: INBOX_STATUS.open,
        onAnswer: ON_ANSWER.resume,
        createdAt: new Date(),
      })
      .run();
    expireStaleDiagnostics("t1", "s-new");
    assert.equal(inboxRow("q1").status, INBOX_STATUS.open);
  });

  it("runTask expires diagnostics on the way (end to end)", async () => {
    makeTask("t1");
    makeSession("s-old", "t1", new Date(Date.now() - 60_000));
    makeDiagnostic("d1", "t1", "s-old");
    await runTask("t1");
    // Fire-and-forget: wait for the consequence, not a guessed delay. A fixed `setTimeout(80)`
    // failed one run in two under the full parallel suite (01/09).
    await until(
      () =>
        inboxRow("d1").status === INBOX_STATUS.closed &&
        activity("t1").some((a) => a.body.includes("Stale")),
    );
    assert.equal(
      inboxRow("d1").status,
      INBOX_STATUS.closed,
      "rerunning the task expires its diagnostic",
    );
    assert.ok(activity("t1").some((a) => a.body.includes("Stale")));
  });
});

describe("answerInbox, a late answer is refused naming the sessions", () => {
  beforeEach(() => reset());

  it("answering an outdated session's diagnostic → named error, nothing written", async () => {
    makeTask("t1");
    makeSession("s-old", "t1", new Date(Date.now() - 60_000));
    makeSession("s-new", "t1", new Date(), "running");
    makeDiagnostic("d1", "t1", "s-old");
    await assert.rejects(
      () => answerInbox("d1", { choiceId: "retry" }),
      (e: Error) => e.message.includes("s-old") && e.message.includes("s-new"),
    );
    assert.equal(inboxRow("d1").status, INBOX_STATUS.open, "no write before the check");
    assert.equal(inboxRow("d1").answeredAt, null);
  });

  it("still allows answering the latest session's diagnostic (drop)", async () => {
    makeTask("t1");
    makeSession("s-only", "t1", new Date());
    makeDiagnostic("d1", "t1", "s-only");
    const answer = await answerInbox("d1", { choiceId: "drop" });
    assert.equal(answer, "Leave it");
    assert.equal(inboxRow("d1").status, INBOX_STATUS.answered);
  });
});
