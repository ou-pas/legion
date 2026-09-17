// A task's inbox history (HSV_FFG00R): the full conversation, closed questions included, which
// `listOpenInbox` never returns.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-history-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { toHistoryEntry, listTaskInboxHistory } = await import("./inbox-history.js");
const { createInboxMessage, answerInbox, closeSessionInbox, createDiagnosticInbox } =
  await import("./inbox.js");
const { validateFormSpec } = await import("./inbox-form.js");
const { resumeSession, runTask } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
// A test that answers an inbox entry wires the resume port itself, with the real implementation.
const { registerSessionResumer } = await import("./ports.js");
registerSessionResumer({ resume: resumeSession, run: runTask });
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { INBOX_KIND } = await import("./inbox-enums.js");
const { INBOX_STATUS } = await import("./inbox-enums.js");
const { ON_ANSWER } = await import("./inbox-enums.js");
const { ANSWERED_BY } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

type Spec = import("../sessions/runner/types.js").SessionSpec;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => ({ id: spec.sessionId, runtime: "fake" }),
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

describe("toHistoryEntry, pure row conversion", () => {
  const base = {
    id: "i1",
    sessionId: "s1",
    taskId: "t1",
    agentId: "a1",
    kind: INBOX_KIND.text,
    body: "a question",
    choices: null,
    form: null,
    evidence: null,
    impact: null,
    selectedChoiceId: null,
    answerText: null,
    status: INBOX_STATUS.open,
    onAnswer: ON_ANSWER.resume,
    reason: "question" as const,
    waitForTaskId: null,
    grantRepoName: null,
    answeredBy: null,
    wakeAt: null,
    // v62: history does not read the draft; a conversation rereads what was said.
    draft: null,
    draftAt: null,
    imageRebuild: null,
    telegramMessageId: null,
    createdAt: new Date(1000),
    answeredAt: null,
  };

  it("open question: answer is null", () => {
    const e = toHistoryEntry(base, { agentName: "senior-dev" });
    assert.equal(e.answer, null);
    assert.equal(e.agentName, "senior-dev");
    assert.equal(e.status, INBOX_STATUS.open);
  });

  it("closed without answer (closeSessionInbox): answer stays null", () => {
    const e = toHistoryEntry({ ...base, status: INBOX_STATUS.closed }, { agentName: "a" });
    assert.equal(e.answer, null);
    assert.equal(e.status, INBOX_STATUS.closed);
  });

  it("answered by choice: selectedChoiceId, label in text, formData null", () => {
    const row = {
      ...base,
      kind: INBOX_KIND.choice,
      status: INBOX_STATUS.answered,
      choices: JSON.stringify([{ id: "yes", label: "Yes" }]),
      selectedChoiceId: "yes",
      answerText: "Yes",
      answeredBy: ANSWERED_BY.human,
      answeredAt: new Date(2000),
    };
    const e = toHistoryEntry(row, { agentName: "a" });
    assert.deepEqual(e.answer, {
      answeredBy: ANSWERED_BY.human,
      answeredAt: 2000,
      selectedChoiceId: "yes",
      text: "Yes",
      formData: null,
    });
  });

  it("answered form: formData rebuilt from answerText, <id>__note notes included", () => {
    const answers = { choice: "a", choice__note: "I prefer A because…" };
    const row = {
      ...base,
      kind: INBOX_KIND.form,
      status: INBOX_STATUS.answered,
      form: JSON.stringify({ blocks: [] }),
      answerText: JSON.stringify(answers),
      answeredBy: ANSWERED_BY.human,
      answeredAt: new Date(3000),
    };
    const e = toHistoryEntry(row, { agentName: "a" });
    assert.deepEqual(e.answer?.formData, answers);
    assert.equal(e.answer?.text, JSON.stringify(answers));
  });

  it("answered form with corrupt answerText: does not throw, formData stays null", () => {
    const row = {
      ...base,
      kind: INBOX_KIND.form,
      status: INBOX_STATUS.answered,
      form: JSON.stringify({ blocks: [] }),
      answerText: "{not json",
      answeredBy: ANSWERED_BY.human,
      answeredAt: new Date(4000),
    };
    const e = toHistoryEntry(row, { agentName: "a" });
    assert.equal(e.answer?.formData, null);
    assert.equal(e.answer?.text, "{not json");
  });

  it("dependency wait (wait_for_task): target resolved, else task deleted", () => {
    const row = { ...base, waitForTaskId: "target" };
    const e = toHistoryEntry(row, {
      agentName: "a",
      waitForTask: { name: "Other task", status: TASK_STATUS.doing },
    });
    assert.equal(e.waitForTaskName, "Other task");
    assert.equal(e.waitForTaskStatus, TASK_STATUS.doing);

    const gone = toHistoryEntry(row, { agentName: "a", waitForTask: null });
    assert.equal(gone.waitForTaskName, "task deleted");
  });
});

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";
const TASK = "t1";

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
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

function newSession(id: string) {
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
    })
    .run();
}

describe("listTaskInboxHistory, a task's conversation across sessions", () => {
  beforeEach(() => reset());

  it("crosses several sessions in chronological order, closed questions included", async () => {
    newSession("s1");
    const q1 = createInboxMessage("s1", { kind: INBOX_KIND.text, body: "first question" });
    await answerInbox(q1.id, { text: "first answer" });

    // A question left unanswered when the session stops: closed, never answered.
    newSession("s2");
    const q2 = createInboxMessage("s2", {
      kind: INBOX_KIND.text,
      body: "second question, never answered",
    });
    closeSessionInbox("s2");

    newSession("s3");
    const q3 = createInboxMessage("s3", {
      kind: INBOX_KIND.choice,
      body: "third question",
      choices: [{ id: "ok", label: "Ok" }],
    });
    await answerInbox(q3.id, { choiceId: "ok" });

    const history = listTaskInboxHistory(TASK);
    assert.deepEqual(
      history.map((e) => e.id),
      [q1.id, q2.id, q3.id],
      "chronological order across 3 sessions",
    );
    assert.equal(history[0]!.answer?.text, "first answer");
    assert.equal(history[1]!.status, INBOX_STATUS.closed);
    assert.equal(history[1]!.answer, null, "closed without answer: no ghost answer");
    assert.equal(history[2]!.answer?.selectedChoiceId, "ok");
  });

  it("returns an answered form's formData with comment keys", async () => {
    newSession("s1");
    const spec = validateFormSpec({
      blocks: [
        {
          kind: "field",
          field: {
            id: "q",
            label: "Strategy",
            type: "radio",
            required: true,
            options: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
          },
        },
      ],
    });
    const created = createInboxMessage("s1", {
      kind: INBOX_KIND.form,
      body: "decision",
      form: spec,
    });
    await answerInbox(created.id, { formData: { q: "a", q__note: "because simpler" } });

    const [entry] = listTaskInboxHistory(TASK);
    assert.deepEqual(entry!.answer?.formData, { q: "a", q__note: "because simpler" });
    assert.ok(entry!.form, "the agent's FormSpec is returned, not just the answer");
  });

  it("includes a failure diagnostic (createDiagnosticInbox) in the thread", () => {
    newSession("s1");
    createDiagnosticInbox(TASK, "the task failed: run it again?");
    const history = listTaskInboxHistory(TASK);
    assert.equal(history.length, 1);
    assert.equal(history[0]!.onAnswer, ON_ANSWER.retryTask);
    assert.equal(history[0]!.status, INBOX_STATUS.open);
  });

  it("never mixes tasks: filters strictly by taskId", () => {
    newSession("s1");
    createInboxMessage("s1", { kind: INBOX_KIND.text, body: "on t1" });
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
    createInboxMessage("s2", { kind: INBOX_KIND.text, body: "on t2" });

    assert.equal(listTaskInboxHistory(TASK).length, 1);
    assert.equal(listTaskInboxHistory("t2").length, 1);
  });
});
