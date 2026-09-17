// The promises of the out-of-quota pause (23/08, evening):
//
//  1. An out-of-quota death is not a success: the SDK closes with `result subtype: success` and the
//     process exits 0, but if the last persisted `throttle` is `rejected` the session does not go
//     "destroyed". It sleeps (waiting) with a dated inbox entry.
//  2. The wake-up is scheduled: `wake_at = resets_at + margin`, and the scheduler tick answers it
//     with `answered_by: system`, so the session resumes without a human remembering at 23:10.
//  3. The human keeps control: answering early wakes it at once; the automatic wake-up then finds
//     the entry closed and does not start a second run.
//  4. No false positives: with no throttle, or a last throttle `allowed`, an exit 0 stays a normal
//     end (destroyed). The fix does not touch the nominal path.
//
// Same harness as wait-for-task.test.ts: real temporary SQLite, injected fake runner
// (`wireFakeRunner`), no Docker.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "./session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-quota-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY = "0".repeat(64);
// No control-plane credential here: otherwise a project without a token would look authenticated
// by the test machine's environment, and the switch would prove nothing.
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { answerInbox } = await import("../inbox/inbox.js");
const { pauseForQuota, quotaRejection, wakeDueQuotaPauses } = await import("./quota-pause.js");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { addCredential } = await import("../projects/credentials/index.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { runLifecycle, resumeSession, runTask } = await import("./runner/manager.js");
const { wireFakeRunner } = await import("./runner/test-wiring.js");
// The resume port (06/09): `index.ts` wires it in production; a test that answers an inbox entry
// must wire it itself, with the real implementation, since that is what is under test.
const { registerSessionResumer } = await import("../inbox/ports.js");
registerSessionResumer({ resume: resumeSession, run: runTask });
const { TASK_STATUS } = await import("../tasks/lifecycle.js");

const PROJECT = "p1";
const AGENT = "a1";
const RUNNER = "r1";

type Spec = import("./runner/types.js").SessionSpec;
let provisioned: Spec[] = [];
wireFakeRunner(() => ({
  kind: RUNNER_KIND.process,
  provision: async (spec: Spec) => {
    provisioned.push(spec);
    return { id: spec.sessionId, runtime: "fake" };
  },
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
}));
after(() => wireFakeRunner(null));

function reset() {
  const now = new Date();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.taskActivity).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.notices).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.credentials).run();
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
  provisioned = [];
}

function makeTask(id: string) {
  const now = new Date();
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.doing,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function makeSession(id: string, taskId: string, status: SessionStatus = "running", mock = true) {
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status,
      callbackToken: "tok",
      mock,
      sdkSessionId: "sdk-1",
      startedAt: new Date(),
    })
    .run();
}

function throttleEvent(sessionId: string, status: "allowed" | "rejected", resetsAt?: number) {
  db.insert(schema.sessionEvents)
    .values({
      sessionId,
      type: "throttle",
      payload: JSON.stringify({
        kind: "rate_limit",
        status,
        rateLimitType: "five_hour",
        ...(resetsAt ? { resetsAt } : {}),
        ts: Date.now(),
      }),
      createdAt: new Date(),
    })
    .run();
}

/** Minimal spec for runLifecycle. `mock: false` is all the out-of-quota path looks at. */
function makeSpec(sessionId: string, taskId: string): Spec {
  return {
    sessionId,
    callbackUrl: "http://localhost:0",
    callbackToken: "tok",
    model: "m",
    effort: null,
    thinking: null,
    taskId,
    taskName: "t",
    taskDescription: "d",
    agentName: "agent",
    rolePrompt: "r",
    repos: [],
    repoBranch: `legion/${taskId}`,
    allowedTools: [],
    inboxEnabled: true,
    artifactsPath: `/artifacts/${taskId}`,
    expectedArtifacts: [],
    goalId: null,
    network: { mode: "open" },
    claudeStateDir: join(dir, "claude"),
    resume: null,
    mock: false,
    env: {},
    mcpServers: {},
    skills: [],
    gitAuthor: { name: "Legion", email: "legion@local" },
  } as unknown as Spec;
}

const doneRunner = {
  kind: RUNNER_KIND.process,
  provision: async () => ({ id: "h", runtime: "fake" }),
  wait: async () => ({ exitCode: 0 }),
  destroy: async () => {},
};

const session = (id: string) =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()!;
const inboxOf = (sessionId: string) =>
  db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.sessionId, sessionId)).all();
/** The first entry, asserting it exists, so TS knows it is non-null afterwards. */
function firstInbox(sessionId: string) {
  const m = inboxOf(sessionId)[0];
  assert.ok(m, "an inbox entry must exist");
  return m;
}

describe("quotaRejection: the truth is in the last throttle", () => {
  beforeEach(() => reset());

  it("no throttle → null: an exit 0 stays a normal end", () => {
    makeTask("t1");
    makeSession("s1", "t1");
    assert.equal(quotaRejection("s1"), null);
  });

  it("last throttle `allowed` → null, even with an older `rejected` lying around", () => {
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "rejected", 1_000_000);
    throttleEvent("s1", "allowed");
    assert.equal(quotaRejection("s1"), null);
  });

  it("last throttle `rejected` → window + resets_at (epoch seconds → Date)", () => {
    makeTask("t1");
    makeSession("s1", "t1");
    const resetsAtS = Math.floor(Date.now() / 1000) + 3600;
    throttleEvent("s1", "rejected", resetsAtS);
    const rej = quotaRejection("s1");
    assert.ok(rej);
    assert.equal(rej.window, "five_hour");
    assert.equal(rej.resetsAt?.getTime(), resetsAtS * 1000);
  });

  it("`rejected` without resets_at → the pause exists, the wake-up will be manual (resetsAt null)", () => {
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "rejected");
    const rej = quotaRejection("s1");
    assert.ok(rej);
    assert.equal(rej.resetsAt, null);
  });

  it("a rejection from a PREVIOUS run does not haunt the current run's exit (02/09: 24 resumes in a loop)", () => {
    // Run 1 is rejected out of quota. On resume, a new `status → running` event opens run 2.
    // Run 2's clean exit must not read the old rejection: that is what put the agent back to
    // sleep every 3 minutes after it had finished its work.
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) - 60);
    db.insert(schema.sessionEvents)
      .values({
        sessionId: "s1",
        type: "status",
        payload: JSON.stringify({ status: "running", runtime: "run-2" }),
        createdAt: new Date(Date.now() + 1),
      })
      .run();
    assert.equal(quotaRejection("s1"), null);
  });

  it("a rejection from the current run (after its `running`) does trigger the pause", () => {
    makeTask("t1");
    makeSession("s1", "t1");
    db.insert(schema.sessionEvents)
      .values({
        sessionId: "s1",
        type: "status",
        payload: JSON.stringify({ status: "running", runtime: "run-1" }),
        createdAt: new Date(Date.now() - 1),
      })
      .run();
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) + 3600);
    assert.ok(quotaRejection("s1"));
  });
});

describe("runLifecycle: an out-of-quota death becomes a pause, never a success", () => {
  beforeEach(() => reset());

  it("exit 0 + last throttle rejected → waiting + dated entry (wake_at > resets_at)", async () => {
    makeTask("t1");
    makeSession("s1", "t1");
    const resetsAtS = Math.floor(Date.now() / 1000) + 3600;
    // The throttle arrives DURING the run, as in production: the runtime reports nothing before
    // it is `running`. Inserting it before launch would date it to the previous run, and the run
    // scope (02/09) would rightly discard it.
    const rejectingRunner = {
      ...doneRunner,
      wait: async () => {
        throttleEvent("s1", "rejected", resetsAtS);
        return { exitCode: 0 };
      },
    };
    await runLifecycle("s1", "t1", rejectingRunner, makeSpec("s1", "t1"));
    assert.equal(
      session("s1").status,
      SESSION_STATUS.waiting,
      "the session sleeps, it is not “finished”",
    );
    assert.equal(session("s1").endedAt, null, "a pause has no end");
    const msg = firstInbox("s1");
    assert.equal(msg.status, "open");
    assert.ok(msg.body.includes("Out of quota"));
    assert.ok(
      (msg.wakeAt?.getTime() ?? 0) > resetsAtS * 1000,
      "the wake-up is AFTER the reset (margin)",
    );
  });

  it("exit 0 without a rejected throttle → destroyed, as before the fix", async () => {
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "allowed");
    await runLifecycle("s1", "t1", doneRunner, makeSpec("s1", "t1"));
    assert.equal(session("s1").status, "destroyed");
    assert.equal(inboxOf("s1").length, 0);
  });

  it("a mock session is never paused for quota", async () => {
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) + 3600);
    const spec = { ...makeSpec("s1", "t1"), mock: true } as Spec;
    await runLifecycle("s1", "t1", doneRunner, spec);
    assert.equal(session("s1").status, "destroyed");
  });
});

describe("wakeDueQuotaPauses: the scheduled wake-up", () => {
  beforeEach(() => reset());

  it("time is up → `system` answer, the session restarts (fake runner provisioned)", async () => {
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) - 600); // reset already past
    pauseForQuota("s1", quotaRejection("s1")!);
    const msg = firstInbox("s1");
    assert.equal(msg.status, "open");
    wakeDueQuotaPauses(msg.wakeAt!.getTime() + 1);
    // The tick fires answerInbox without awaiting it: let the microtask finish.
    await new Promise((r) => setTimeout(r, 50));
    const woken = firstInbox("s1");
    assert.equal(woken.status, "answered");
    assert.equal(woken.answeredBy, "system");
    assert.equal(provisioned.length, 1, "the resume provisioned a session");
  });

  it("not time yet → nothing moves", () => {
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) + 3600);
    pauseForQuota("s1", quotaRejection("s1")!);
    wakeDueQuotaPauses(Date.now());
    assert.equal(firstInbox("s1").status, "open");
  });

  it("the human answered first → the wake-up finds the entry closed and starts nothing twice", async () => {
    makeTask("t1");
    makeSession("s1", "t1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) - 600);
    pauseForQuota("s1", quotaRejection("s1")!);
    const msg = firstInbox("s1");
    await answerInbox(msg.id, { text: "go on right now" });
    assert.equal(firstInbox("s1").answeredBy, "human");
    const before = provisioned.length;
    wakeDueQuotaPauses(msg.wakeAt!.getTime() + 1);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(firstInbox("s1").answeredBy, "human", "the human answer is not overwritten");
    assert.equal(provisioned.length, before, "no second resume");
  });

  it("an ordinary question (no wake_at) is never woken by the tick", async () => {
    makeTask("t1");
    makeSession("s1", "t1");
    const { createInboxMessage } = await import("../inbox/inbox.js");
    createInboxMessage("s1", { kind: "text", body: "a real question for a human" });
    wakeDueQuotaPauses(Date.now() + 365 * 24 * 3600 * 1000);
    assert.equal(firstInbox("s1").status, "open");
  });
});

describe("several credentials: switch instead of sleeping", () => {
  beforeEach(() => reset());

  /** Two subscriptions on the project, and the session runs on the first. */
  function twoAccounts(sessionId: string): { perso: string; pro: string } {
    const perso = addCredential({ projectId: PROJECT, value: "sk-ant-oat-perso", label: "Perso" });
    const pro = addCredential({ projectId: PROJECT, value: "sk-ant-oat-pro", label: "Pro" });
    assert.ok(perso.ok && pro.ok);
    db.update(schema.sessions)
      .set({ credentialId: perso.id })
      .where(eq(schema.sessions.id, sessionId))
      .run();
    return { perso: perso.id, pro: pro.id };
  }

  /** Exhaustion is read on the account ROW since the per-window table is gone. Only accounts
   *  actually marked come out: a null `exhausted_until` is not a missing row, it is a free
   *  account. */
  const exhaustions = () =>
    db
      .select()
      .from(schema.credentials)
      .all()
      .filter((c) => c.exhaustedUntil !== null)
      .map((c) => ({ credentialId: c.id, window: c.exhaustedWindow, until: c.exhaustedUntil! }));

  it("exhaustion is recorded for the account THAT WAS USED, on its window, with its reset", async () => {
    makeTask("t1");
    makeSession("s1", "t1", "running", false);
    const { perso } = twoAccounts("s1");
    const resetsAtS = Math.floor(Date.now() / 1000) + 3600;
    throttleEvent("s1", "rejected", resetsAtS);
    pauseForQuota("s1", quotaRejection("s1")!);

    assert.deepEqual(
      exhaustions().map((e) => [e.credentialId, e.window, e.until.getTime()]),
      [[perso, "five_hour", resetsAtS * 1000]],
      "the next account is not marked: it did nothing",
    );
  });

  it("another account is free → immediate wake-up, and the resume runs ON IT", async () => {
    makeTask("t1");
    makeSession("s1", "t1", "running", false);
    const { pro } = twoAccounts("s1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) + 3600);
    pauseForQuota("s1", quotaRejection("s1")!);

    const msg = firstInbox("s1");
    assert.match(msg.body, /I switch to “Pro”/);
    assert.ok(
      (msg.wakeAt?.getTime() ?? Infinity) <= Date.now(),
      "no sleeping: the wake-up is due right away",
    );

    wakeDueQuotaPauses(Date.now() + 1);
    await new Promise((r) => setTimeout(r, 50));
    const spec = provisioned.at(-1);
    assert.equal(
      spec?.env.CLAUDE_CODE_OAUTH_TOKEN,
      "sk-ant-oat-pro",
      "the container restarts with the OTHER token",
    );
    assert.equal(
      session("s1").credentialId,
      pro,
      "and the session records which account it now runs on",
    );
  });

  it("the exhausted account is not retried before its reset: no A → B → A loop", async () => {
    // The resume on “Pro” dies in turn. Nothing free is left: sleep, and above all do not restart
    // on “Perso”, whose window is still closed. Each attempt costs a container start.
    makeTask("t1");
    makeSession("s1", "t1", "running", false);
    const { perso, pro } = twoAccounts("s1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) + 7200);
    pauseForQuota("s1", quotaRejection("s1")!);

    db.update(schema.sessions)
      .set({ credentialId: pro, status: SESSION_STATUS.running })
      .where(eq(schema.sessions.id, "s1"))
      .run();
    db.delete(schema.inboxMessages).run();
    const proResetS = Math.floor(Date.now() / 1000) + 3600;
    throttleEvent("s1", "rejected", proResetS);
    pauseForQuota("s1", quotaRejection("s1")!);

    const msg = firstInbox("s1");
    assert.match(msg.body, /I resume on my own/, "no free account: sleep");
    assert.doesNotMatch(msg.body, /I switch/);
    assert.ok(
      msg.wakeAt!.getTime() > proResetS * 1000,
      "the wake-up is AFTER the nearest reset (margin)",
    );
    assert.ok(
      msg.wakeAt!.getTime() < (proResetS + 7200) * 1000,
      "and not after “Perso”'s, which reopens later",
    );
    assert.equal(exhaustions().length, 2, "both accounts are marked, each with ITS own time");
    assert.deepEqual(
      exhaustions()
        .map((e) => e.credentialId)
        .sort(),
      [perso, pro].sort(),
    );
  });

  it("the switch wake-up does not claim the quota came back", async () => {
    makeTask("t1");
    makeSession("s1", "t1", "running", false);
    twoAccounts("s1");
    throttleEvent("s1", "rejected", Math.floor(Date.now() / 1000) + 3600);
    pauseForQuota("s1", quotaRejection("s1")!);
    wakeDueQuotaPauses(Date.now() + 1);
    await new Promise((r) => setTimeout(r, 50));
    const answered = firstInbox("s1");
    assert.equal(answered.answeredBy, "system");
    assert.doesNotMatch(
      answered.answerText ?? "",
      /reset/,
      "the resume prompt cannot claim that: the account changed",
    );
  });
});
