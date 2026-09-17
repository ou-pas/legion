// Reported bug: errors did not show when replying (/artifacts/WqKo6m9II1/diagnostic.md). On the
// retry-task path a failed rerun used to be swallowed by a `console.warn` and the route answered
// 200. Reproduces the report (GITHUB_TOKEN on the project but not granted to the agent) and checks
// that `answerInbox` rejects, as the resume path does.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-inbox-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { answerInbox } = await import("./inbox.js");
// The real implementation: a fake resumer would only prove the port relays a rejected promise.
const { resumeSession, runTask } = await import("../sessions/runner/manager.js");
const { registerSessionResumer } = await import("./ports.js");
registerSessionResumer({ resume: resumeSession, run: runTask });
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { INBOX_KIND } = await import("./inbox-enums.js");
const { INBOX_STATUS } = await import("./inbox-enums.js");
const { ON_ANSWER } = await import("./inbox-enums.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { REPO_ACCESS } = await import("../shared/enums.js");

const PROJECT = "p1";
const AGENT = "senior-dev";
const REPO = "legion";

it("answerInbox (retry-task) surfaces a failed rerun instead of hiding it", async () => {
  const now = new Date();

  // GITHUB_TOKEN exists on the project but is not granted: the preflight refuses runTask before
  // any container or network call, so the failure is deterministic.
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.repos)
    .values({
      id: "r1",
      projectId: PROJECT,
      name: REPO,
      url: "https://github.com/acme/legion.git",
      createdAt: now,
    })
    .run();
  db.insert(schema.secrets)
    .values({ id: "s1", projectId: PROJECT, name: "GITHUB_TOKEN", ciphertext: "x", createdAt: now })
    .run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: AGENT,
      rolePrompt: "r",
      repoAccess: REPO_ACCESS.write,
      repoNames: JSON.stringify([REPO]),
      envSecretNames: JSON.stringify([]), // not granted: the heart of the report
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: "run1", name: "run1", kind: RUNNER_KIND.process }).run();

  const taskId = "t1";
  db.insert(schema.tasks)
    .values({
      id: taskId,
      projectId: PROJECT,
      name: "task",
      assigneeAgentId: AGENT,
      status: TASK_STATUS.review,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  // The failed previous session produced the diagnostic; no active session, so runTask reaches
  // the repository/secret check.
  const sessionId = "sess1";
  db.insert(schema.sessions)
    .values({
      id: sessionId,
      taskId,
      agentId: AGENT,
      runnerId: "run1",
      model: "m",
      status: "failed",
      callbackToken: "tok",
      startedAt: now,
    })
    .run();

  const inboxId = "inbox1";
  db.insert(schema.inboxMessages)
    .values({
      id: inboxId,
      sessionId,
      taskId,
      agentId: AGENT,
      kind: INBOX_KIND.choice,
      body: "The task failed: diagnostic. Run again?",
      choices: JSON.stringify([
        { id: "retry", label: "Run the task again with this diagnostic" },
        { id: "drop", label: "Leave it in review" },
      ]),
      status: INBOX_STATUS.open,
      onAnswer: ON_ANSWER.retryTask,
      createdAt: now,
    })
    .run();

  await assert.rejects(
    () => answerInbox(inboxId, { choiceId: "retry" }),
    /GITHUB_TOKEN exists on the project but is not granted/,
    "answerInbox resolved although the rerun (runTask) failed: the error was swallowed",
  );

  // The question must not stay answered as if the rerun had succeeded.
  const after1 = db
    .select()
    .from(schema.inboxMessages)
    .where(eq(schema.inboxMessages.id, inboxId))
    .get();
  assert.notEqual(after1?.status, INBOX_STATUS.answered);
});
