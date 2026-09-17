// `answerInbox` must attempt the memory-to-rule suggestion (an SDK call) only on free text written
// by a human (04/09). On 03/09 form submissions triggered it and saturated five suggestions with
// copied field ids. `setRuleSuggesterForTests` swaps in a spy, so the test measures whether the
// trigger happened.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-rulesuggest-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { createInboxMessage, answerInbox, setRuleSuggesterForTests } = await import("./inbox.js");
const { resumeSession, runTask } = await import("../sessions/runner/manager.js");
const { wireFakeRunner } = await import("../sessions/runner/test-wiring.js");
// A test that answers an inbox entry wires the resume port itself, with the real implementation.
const { registerSessionResumer } = await import("./ports.js");
registerSessionResumer({ resume: resumeSession, run: runTask });
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { INBOX_KIND } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { validateFormSpec } = await import("./inbox-form.js");

type Spec = import("../sessions/runner/types.js").SessionSpec;
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => ({ id: spec.sessionId, runtime: "fake" }),
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

const PROJECT = "p-rs",
  AGENT = "a-rs",
  TASK = "t-rs",
  SESSION = "s-rs",
  RUNNER = "r-rs";

let calls: unknown[] = [];
setRuleSuggesterForTests((input) => {
  calls.push(input);
});
after(() => setRuleSuggesterForTests(null));

const FORM = validateFormSpec({
  blocks: [
    {
      kind: "field",
      field: {
        id: "goal_case",
        label: "Case",
        type: "radio",
        options: [
          { id: "archive", label: "Archive" },
          { id: "erase", label: "Erase" },
        ],
      },
    },
  ],
});

function reset(): void {
  calls = [];
  const now = new Date();
  for (const t of [
    schema.sessionEvents,
    schema.inboxMessages,
    schema.taskActivity,
    schema.sessions,
    schema.tasks,
    schema.runners,
    schema.agents,
    schema.projects,
  ])
    db.delete(t).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p-rs", createdAt: now }).run();
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
  // mock: false; the `!session.mock` guard is covered elsewhere, this isolates the shape guard.
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: TASK,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status: "running",
      callbackToken: "tok",
      mock: false,
      sdkSessionId: "sdk",
      startedAt: now,
    })
    .run();
}

describe("answerInbox, the memory-to-rule trigger follows the answer's shape", () => {
  beforeEach(reset);

  // Each answer resumes the session in the background; let it finish before the next reset, or it
  // may write into the next test's fresh rows (same ids).
  const settle = () => new Promise((r) => setTimeout(r, 80));

  it("triggers on free text of 20 characters or more", async () => {
    const created = createInboxMessage(SESSION, {
      kind: INBOX_KIND.text,
      body: "An open question?",
    });
    await answerInbox(created.id, {
      text: "always archive a goal before deleting it, never directly",
    });
    assert.equal(calls.length, 1, "free text must trigger a call");
    await settle();
  });

  it("never triggers on a form submission (formData)", async () => {
    const created = createInboxMessage(SESSION, {
      kind: INBOX_KIND.form,
      body: "Three decisions at once",
      form: FORM,
    });
    await answerInbox(created.id, { formData: { goal_case: "archive" } });
    assert.equal(calls.length, 0, "a form answer must produce no model call");
    await settle();
  });

  it("still triggers on free text overriding a form (human first)", async () => {
    const created = createInboxMessage(SESSION, {
      kind: INBOX_KIND.form,
      body: "Three decisions at once",
      form: FORM,
    });
    await answerInbox(created.id, { text: "no, do X instead, let me explain why in detail" });
    assert.equal(calls.length, 1);
    await settle();
  });

  it("never triggers on a bare click (choiceId)", async () => {
    const created = createInboxMessage(SESSION, {
      kind: INBOX_KIND.choice,
      body: "Continue?",
      choices: [{ id: "go", label: "Continue, this budget is justified and I confirm it" }],
    });
    await answerInbox(created.id, { choiceId: "go" });
    assert.equal(
      calls.length,
      0,
      "a click must produce no call, even with a choice label over 20 characters",
    );
    await settle();
  });
});
