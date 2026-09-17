// What the session remembers about the account it spends, and why.
//
// Without that memory, an out-of-quota stop would reread the resolution AFTERWARDS: it would return
// the NEXT account (the dead one just excluded), marking as exhausted an account that is not, and
// leaving alive the one that just died. That is the one defect this module exists to prevent.
//
// Real SQLite, like `credentials.test.ts`: what is proven here is a database WRITE.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-session-credential-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY = "0".repeat(64);
// The control plane fallback must be EMPTY: otherwise a project without credentials would pass for
// authenticated by the test machine's environment, and the no-account case would never be
// exercised.
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { sessionCredentialEnv } = await import("./session-credential.js");
const { addCredential, recordExhaustion } = await import("../projects/credentials/index.js");
const { putSecret } = await import("../projects/secrets.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const PROJECT = "prj-sc";
const AGENT = "agt-sc";
const RUNNER = "run-sc";
const TASK = "tsk-sc";
const SESSION = "ses-sc";
const OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";
const HOUR = 3_600_000;

function reset(): void {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.credentials).run();
  db.delete(schema.secrets).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: AGENT, projectId: PROJECT, name: "a", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({ id: TASK, projectId: PROJECT, name: "t", createdAt: now, updatedAt: now })
    .run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: TASK,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

const session = () =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, SESSION)).get()!;

describe("sessionCredentialEnv", () => {
  beforeEach(() => reset());

  it("returns the rank-1 token and RECORDS on the session the account that will serve", () => {
    const perso = addCredential({
      projectId: PROJECT,
      value: "sk-ant-oat-personal",
      label: "Personal",
    });
    assert.ok(perso.ok);
    if (!perso.ok) return;

    const env = sessionCredentialEnv(SESSION, PROJECT);
    assert.deepEqual(env, { [OAUTH]: "sk-ant-oat-personal" });
    assert.equal(session().credentialId, perso.id);
  });

  it("the recorded account is the one that SERVES, not rank 1 when it is exhausted", () => {
    // THE defect this module prevents: marking the next account exhausted instead of the dead one.
    const perso = addCredential({
      projectId: PROJECT,
      value: "sk-ant-oat-personal",
      label: "Personal",
    });
    const pro = addCredential({ projectId: PROJECT, value: "sk-ant-oat-work", label: "Work" });
    assert.ok(perso.ok && pro.ok);
    if (!perso.ok || !pro.ok) return;
    recordExhaustion(perso.id, "five_hour", new Date(Date.now() + 3 * HOUR));

    const env = sessionCredentialEnv(SESSION, PROJECT);
    assert.deepEqual(env, { [OAUTH]: "sk-ant-oat-work" });
    assert.equal(session().credentialId, pro.id, "“Work” is spending, so it is the one recorded");
  });

  it("REWRITTEN at every call: a resume after a switch does not keep the dead account", () => {
    const perso = addCredential({
      projectId: PROJECT,
      value: "sk-ant-oat-personal",
      label: "Personal",
    });
    const pro = addCredential({ projectId: PROJECT, value: "sk-ant-oat-work", label: "Work" });
    assert.ok(perso.ok && pro.ok);
    if (!perso.ok || !pro.ok) return;

    sessionCredentialEnv(SESSION, PROJECT);
    assert.equal(session().credentialId, perso.id);

    recordExhaustion(perso.id, "five_hour", new Date(Date.now() + 3 * HOUR));
    sessionCredentialEnv(SESSION, PROJECT);
    assert.equal(session().credentialId, pro.id, "the CURRENT account, not the previous run's");
  });

  it("an unranked fallback records NOTHING: it is not schedulable, so it is never exhausted", () => {
    // A project API key does open a session, but has no rank and no window: nowhere to write its
    // exhaustion, and nothing to take over.
    putSecret({ projectId: PROJECT, name: "ANTHROPIC_API_KEY", value: "sk-ant-api-xyz" });

    const env = sessionCredentialEnv(SESSION, PROJECT);
    assert.deepEqual(env, { ANTHROPIC_API_KEY: "sk-ant-api-xyz" });
    assert.equal(session().credentialId, null);
  });

  it("all accounts exhausted: the first to reopen is still returned, and recorded", () => {
    // The session sleeps and will restart on it: `pauseForQuota` needs to know which account the
    // wake-up will run on, even when none is free right now.
    const perso = addCredential({
      projectId: PROJECT,
      value: "sk-ant-oat-personal",
      label: "Personal",
    });
    const pro = addCredential({ projectId: PROJECT, value: "sk-ant-oat-work", label: "Work" });
    assert.ok(perso.ok && pro.ok);
    if (!perso.ok || !pro.ok) return;
    recordExhaustion(perso.id, "seven_day", new Date(Date.now() + 48 * HOUR));
    recordExhaustion(pro.id, "five_hour", new Date(Date.now() + 2 * HOUR));

    const env = sessionCredentialEnv(SESSION, PROJECT);
    assert.deepEqual(env, { [OAUTH]: "sk-ant-oat-work" }, "the one reopening FIRST");
    assert.equal(session().credentialId, pro.id);
  });

  it("no credential anywhere: empty environment, and nothing to record", () => {
    const env = sessionCredentialEnv(SESSION, PROJECT);
    assert.deepEqual(env, {});
    assert.equal(session().credentialId, null);
  });
});
