// Automatic relaunch of a long run, end to end (10/09). The promises of decision D4 from the 10/09
// interview:
//
//  1. A moving session asks nothing. It files an inbox entry with an immediate wake-up, goes
//     `waiting` (so its container is destroyed), and the scheduler tick relaunches it with
//     `answeredBy: system`. No entry waits for a human: the difference between an unattended night
//     of work and a click every 375 turns.
//  2. The resume is counted and the measurement passed on: `resumeCount` goes up, and the resume
//     prompt carries the text composed by the container that just died; otherwise the woken session
//     knows neither why it was moved nor what it had produced.
//  3. No investigating in the dark: one `control_event` per relaunch naming the session, task, turns
//     and resume number, plus an event in the task trace.
//  4. The third relaunch notifies the operator, once: the only bound on an uncapped relaunch, and the
//     10 s anti-spam must not swallow it.
//
// Same harness as quota-pause.test.ts: real temporary SQLite, injected fake runner, no Docker.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "./session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-relaunch-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
process.env.LEGION_MASTER_KEY = "0".repeat(64);
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { relaunchForTurnBudget, RELAUNCH_NOTIFY_AT } = await import("./turn-relaunch.js");
const { wakeDueQuotaPauses } = await import("./quota-pause.js");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { WAIT_REASON, needsOperator } = await import("../inbox/wait-reason.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { resumeSession, runTask } = await import("./runner/manager.js");
const { wireFakeRunner } = await import("./runner/test-wiring.js");
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

/** Webhooks go out through global `fetch`, fire-and-forget: it is intercepted to read what the
 *  operator would have received. The only way to observe an outbound notification: it leaves no
 *  database row. */
const realFetch = globalThis.fetch;
let notified: { event: string; payload: Record<string, unknown> }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: { body?: string }) => {
  if (String(url) === "https://hook.test/") {
    notified.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response("ok");
  }
  return realFetch(url as string, init as RequestInit);
}) as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

function reset() {
  const now = new Date();
  for (const t of [
    schema.sessionEvents,
    schema.inboxMessages,
    schema.controlEvents,
    schema.taskActivity,
    schema.webhooks,
    schema.sessions,
    schema.tasks,
    schema.runners,
    schema.agents,
    schema.projects,
  ])
    db.delete(t).run();
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
      id: "t1",
      projectId: PROJECT,
      name: "a long run",
      status: TASK_STATUS.doing,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  provisioned = [];
  notified = [];
}

function makeSession(
  id: string,
  { status = SESSION_STATUS.running as SessionStatus, resumeCount = 0 } = {},
) {
  db.insert(schema.sessions)
    .values({
      id,
      taskId: "t1",
      agentId: AGENT,
      runnerId: RUNNER,
      model: "m",
      status,
      callbackToken: "tok",
      mock: true,
      sdkSessionId: "sdk-1",
      resumeCount,
      startedAt: new Date(),
    })
    .run();
}

const REQUEST = {
  used: 175,
  pauseAt: 175,
  cap: 200,
  notice: "[Legion] Your previous session reached 175 turns and was moving.",
  measure: {
    idleTurns: 4,
    sinceTurn: 171,
    commits: 6,
    writes: 48,
    lastCommitTurn: 171,
    writable: true,
  },
};

const session = (id: string) =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()!;
const inbox = () => db.select().from(schema.inboxMessages).all();
const controlEvents = () => db.select().from(schema.controlEvents).all();
const traceOf = (id: string) =>
  db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, id)).all();

function webhook() {
  db.insert(schema.webhooks)
    .values({
      id: "w1",
      url: "https://hook.test/",
      events: "[]",
      enabled: true,
      createdAt: new Date(),
    })
    .run();
}

describe("relaunchForTurnBudget: it is moving, so it restarts", () => {
  beforeEach(() => reset());

  it("files an entry with an immediate wake-up, and nobody is waited for", () => {
    makeSession("s1");
    const res = relaunchForTurnBudget("s1", REQUEST);
    assert.ok(res.ok);
    const [m] = inbox();
    assert.ok(m);
    assert.equal(m.status, "open");
    assert.equal(m.reason, WAIT_REASON.turnRelaunch);
    assert.ok(m.wakeAt, "a wake-up time, otherwise nothing restarts it");
    assert.ok(m.wakeAt.getTime() <= Date.now(), "and that time is NOW");
    assert.equal(
      needsOperator(WAIT_REASON.turnRelaunch),
      false,
      "no entry may wait for a human: the whole point of the decision",
    );
    assert.equal(session("s1").status, SESSION_STATUS.waiting);
  });

  it("the body carries the measurement AND the container's text: it has two readers", () => {
    makeSession("s1", { resumeCount: 1 });
    const res = relaunchForTurnBudget("s1", REQUEST);
    assert.ok(res.ok);
    assert.equal(res.value.resume, 2, "the announced number is the COMING resume's");
    const [m] = inbox();
    assert.match(m!.body, /Automatic resume no. 2/);
    assert.match(m!.body, /6 commit\(s\) pushed, 48 successful write\(s\)/);
    assert.match(m!.body, /175 turns consumed/);
    assert.match(m!.body, /Your previous session reached 175 turns/, "the container's text");
  });

  it("writes a control_event naming the session, task and resume, and a trace line", () => {
    makeSession("s1");
    relaunchForTurnBudget("s1", REQUEST);
    const ev = controlEvents().find((e) => e.source === "turns");
    assert.ok(ev, "investigation happens hours later: a line is needed");
    assert.equal(ev.level, "info");
    assert.match(ev.message, /session s1 restarted automatically at turn 175 \(resume 1\)/);
    const payload = JSON.parse(ev.payload ?? "{}") as Record<string, unknown>;
    assert.equal(payload.taskId, "t1");
    assert.equal(payload.commits, 6);
    assert.equal(payload.writes, 48);
    const trace = traceOf("s1").find((e) => e.type === "turn_relaunch");
    assert.ok(trace, "and a line in the trace, next to turn_budget_warning");
    assert.equal((JSON.parse(trace.payload) as { resume: number }).resume, 1);
  });

  it("the wake-up restarts the session: resumeCount goes up, the measurement enters the prompt", async () => {
    makeSession("s1");
    relaunchForTurnBudget("s1", REQUEST);
    wakeDueQuotaPauses(Date.now() + 1);
    // `answerInbox` is fired without being awaited (the tick's contract): let the microtask finish.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(session("s1").resumeCount, 1);
    assert.equal(inbox()[0]!.status, "answered");
    const spec = provisioned.at(-1);
    assert.ok(spec, "a new container was provisioned");
    assert.match(spec.resume!.prompt, /hit its turn budget while making progress/);
    assert.match(spec.resume!.prompt, /Your previous session reached 175 turns/);
    assert.ok(
      !spec.resume!.prompt.includes("waiting for another Legion task"),
      "it was waiting for no task, and the prompt must not invent one",
    );
  });

  it("a session no longer alive is refused NAMING its state", () => {
    makeSession("s1", { status: SESSION_STATUS.waiting });
    const res = relaunchForTurnBudget("s1", REQUEST);
    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.match(res.error, /waiting/);
    assert.equal(inbox().length, 0, "no entry filed on an already paused session");
  });

  it("unknown session → 404, and nothing written", () => {
    const res = relaunchForTurnBudget("nope", REQUEST);
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal(controlEvents().length, 0);
  });

  it("the text counts no commits when no repository is writable", () => {
    makeSession("s1");
    relaunchForTurnBudget("s1", {
      ...REQUEST,
      measure: { ...REQUEST.measure, writable: false, commits: 0, lastCommitTurn: null },
    });
    assert.match(inbox()[0]!.body, /no repo in write mode/);
  });
});

describe("the third relaunch notifies the operator, once", () => {
  beforeEach(() => reset());

  it("neither the first nor the second", async () => {
    webhook();
    for (const before of [0, 1]) {
      makeSession(`s${before}`, { resumeCount: before });
      relaunchForTurnBudget(`s${before}`, REQUEST);
    }
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(notified, [], "a notification per relaunch would wear the notification out");
  });

  it("the third, yes, and the 10 s anti-spam does not swallow it", async () => {
    webhook();
    makeSession("s1", { resumeCount: RELAUNCH_NOTIFY_AT - 1 });
    relaunchForTurnBudget("s1", REQUEST);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(notified.length, 1);
    assert.equal(notified[0]!.event, "session_relaunched");
    assert.equal(notified[0]!.payload.resume, RELAUNCH_NOTIFY_AT);
    assert.equal(notified[0]!.payload.sessionId, "s1");
    assert.equal(notified[0]!.payload.taskId, "t1");
  });

  it("the fourth does not notify again", async () => {
    webhook();
    makeSession("s1", { resumeCount: RELAUNCH_NOTIFY_AT });
    relaunchForTurnBudget("s1", REQUEST);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(notified, []);
  });
});
