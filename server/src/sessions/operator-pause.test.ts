// The operator-requested pause (26/08). Two things to protect, and they differ.
//
// The refusal during `committing`, the `git push` phase and the only state where a pause could cost
// work. Everything else in this mechanism is safe by construction; this exception is why
// `pauseRefusal` exists separately and is tested without a database.
//
// Intent is not fact. An agent may finish its task before reading the request; pausing that session
// would create a moot inbox question and a resume with nothing to do. The flag says "it was asked";
// the `operator_pause` event says "it did it". The latter decides.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "legion-oppause-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { eq } = await import("drizzle-orm");
const {
  clearPauseRequest,
  isPauseRequested,
  pauseForOperator,
  pauseHonored,
  pauseRefusal,
  requestPause,
} = await import("./operator-pause.js");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P = "p-op",
  A = "a-op",
  T = "t-op",
  R = "r-op",
  S = "s-op";
const now = new Date();

function reset(status = "running"): void {
  db.delete(schema.sessionEvents).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: P, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A, projectId: P, name: "ag", rolePrompt: "r", createdAt: now })
    .run();
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
  db.insert(schema.runners).values({ id: R, name: "local", kind: RUNNER_KIND.docker }).run();
  db.insert(schema.sessions)
    .values({
      id: S,
      taskId: T,
      agentId: A,
      runnerId: R,
      status: status as "running",
      model: "sonnet",
      callbackToken: "tok-op",
      startedAt: now,
    })
    .run();
}

const session = () => db.select().from(schema.sessions).where(eq(schema.sessions.id, S)).get()!;

describe("who may be paused", () => {
  it("a running session, and only that", () => {
    assert.equal(pauseRefusal("running"), null);
  });

  it("NEVER DURING A PUSH, and the refusal says why", () => {
    // The only refusal that really protects something. Without it a click at the wrong moment would
    // interrupt a `git push`, the only way to lose work with this mechanism.
    const r = pauseRefusal("committing");
    assert.equal(r?.status, 409);
    assert.match(r?.error ?? "", /push/);
    assert.match(r?.error ?? "", /lose work/);
  });

  it("a starting session: nothing to save, it points to stop", () => {
    const r = pauseRefusal("starting");
    assert.equal(r?.status, 409);
    assert.match(r?.error ?? "", /“stop”/);
  });

  it("an already paused session says so instead of a curt refusal", () => {
    assert.match(pauseRefusal(SESSION_STATUS.waiting)?.error ?? "", /already paused/);
  });

  it("a finished session", () => {
    for (const s of ["destroyed", "failed"]) assert.equal(pauseRefusal(s)?.status, 409);
  });

  it("an unknown or missing status is a 404, not a 409", () => {
    // The distinction matters to the UI: 409 = "not now", 404 = "not this session".
    assert.equal(pauseRefusal(null)?.status, 404);
    assert.equal(pauseRefusal(undefined)?.status, 404);
    assert.equal(pauseRefusal("anything")?.status, 404);
  });
});

describe("requesting the pause", () => {
  beforeEach(() => reset("running"));

  it("raises the flag and leaves the session RUNNING", () => {
    // An intermediate status would lie: between request and stop, the agent works.
    assert.equal(requestPause(S), null);
    assert.equal(isPauseRequested(S), true);
    assert.equal(session().status, "running");
  });

  it("leaves a trace, so a click never seems lost", () => {
    requestPause(S);
    const types = db
      .select()
      .from(schema.sessionEvents)
      .all()
      .map((e) => e.type);
    assert.ok(types.includes("pause_requested"));
  });

  it("two clicks break nothing", () => {
    assert.equal(requestPause(S), null);
    assert.equal(requestPause(S), null);
    assert.equal(isPauseRequested(S), true);
  });

  // One line per request, not per attempt (14/09). `suspendActiveSessions` asks again every two
  // seconds for five minutes, on purpose: a `starting` session refuses the pause and must be caught.
  // But republishing at each pass drowned two sessions' timelines under 288 identical lines, while
  // trying to find out precisely why the pause did not arrive.
  it("asking a hundred times leaves a single trace", () => {
    for (let i = 0; i < 100; i++) requestPause(S);
    const traces = db
      .select()
      .from(schema.sessionEvents)
      .all()
      .filter((e) => e.type === "pause_requested");
    assert.equal(traces.length, 1, "the suspension loop must not write a hundred lines");
    assert.equal(isPauseRequested(S), true, "and the flag stays raised");
  });

  // The flag is rewritten at EVERY call even when the trace stays silent: cleared between two passes
  // (a resume, a concurrent `clearPauseRequest`), it must be raised by the next one. The intent is
  // unconditional, not the trace.
  it("raises again a flag cleared between two passes", () => {
    requestPause(S);
    clearPauseRequest(S);
    assert.equal(isPauseRequested(S), false);
    requestPause(S);
    assert.equal(isPauseRequested(S), true);
  });

  it("refused during a push, and the flag is not raised", () => {
    reset("committing");
    const r = requestPause(S);
    assert.equal(r?.status, 409);
    assert.equal(isPauseRequested(S), false);
  });

  it("an unknown session", () => {
    assert.equal(requestPause("does-not-exist")?.status, 404);
  });
});

describe("intent is not fact", () => {
  beforeEach(() => reset("running"));

  it("flag raised but no `operator_pause`: the runtime did not honour it", () => {
    // The exact case protected: the agent finished its task before reading the request. The control
    // plane must NOT pause a session that finished its work.
    requestPause(S);
    assert.equal(isPauseRequested(S), true);
    assert.equal(pauseHonored(S), false);
  });

  it("the runtime's event is authoritative", () => {
    db.insert(schema.sessionEvents)
      .values({
        sessionId: S,
        type: "operator_pause",
        payload: JSON.stringify({ turn: 12 }),
        createdAt: now,
      })
      .run();
    assert.equal(pauseHonored(S), true);
  });

  it("a pause honoured by a PREVIOUS run does not count for the current run (02/09)", () => {
    // Same haunting as the quota: the event dates from the run before the resume. The next run's
    // clean exit is a normal end, not a pause to set again.
    db.insert(schema.sessionEvents)
      .values({
        sessionId: S,
        type: "operator_pause",
        payload: JSON.stringify({ turn: 12 }),
        createdAt: now,
      })
      .run();
    db.insert(schema.sessionEvents)
      .values({
        sessionId: S,
        type: "status",
        payload: JSON.stringify({ status: "running", runtime: "run-2" }),
        createdAt: new Date(now.getTime() + 1),
      })
      .run();
    assert.equal(pauseHonored(S), false);
  });

  it("a request does not outlive its session", () => {
    requestPause(S);
    clearPauseRequest(S);
    assert.equal(isPauseRequested(S), false);
  });
});

describe("the pause itself takes the inbox rail", () => {
  beforeEach(() => reset("running"));

  it("files an inbox entry, which puts the session in waiting", () => {
    // No new status, no new mechanism: `createInboxMessage` holds the session, exactly as for an
    // agent question or an out-of-quota pause.
    pauseForOperator(S);
    assert.equal(session().status, SESSION_STATUS.waiting);
    const msgs = db.select().from(schema.inboxMessages).all();
    assert.equal(msgs.length, 1);
    assert.match(msgs[0]!.body, /Paused at your request/);
    assert.equal(isPauseRequested(S), false);
  });

  it("the entry says what is NOT lost", () => {
    // A pause that does not say what it preserves reads as a loss.
    pauseForOperator(S);
    const m = db.select().from(schema.inboxMessages).all()[0]!;
    assert.match(m.impact ?? "", /branch/);
    assert.match(m.impact ?? "", /conversation/);
  });
});
