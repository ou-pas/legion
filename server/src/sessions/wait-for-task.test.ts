// The five promises of `wait_for_task` (brief of 23/08):
//
//  1. Deadlock is refused AT REQUEST TIME, named, never discovered three hours later on a frozen
//     board. Including the cycle through a CHAIN (each step blocked by the previous one): waiting on
//     a step that will only start once yours is finished is the same deadlock written differently,
//     and the one built without meaning to.
//  2. No pause for nothing: a target already `done` answers at once.
//  3. A wake-up SAYS WHY and carries the awaited task's RESULT (branch, artifacts, report),
//     otherwise the session goes back to exploring and the wait saved nothing.
//  4. The target can disappear: deletion → immediate, named wake-up, never an eternal sleeper
//     waiting for a done that will not come.
//  5. The human keeps control: they can answer BEFORE the system; the system then finds the entry
//     closed and wakes nobody twice.
//
// Real temporary SQLite, like lifecycle.test.ts / steering.test.ts. No Docker: test runners are
// `kind: RUNNER_KIND.process` and the runner factory is injected (`wireFakeRunner`).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { SessionStatus } from "./session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-wait-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { answerInbox, listOpenInbox } = await import("../inbox/inbox.js");
const { onTaskDone, settleDone } = await import("../chains/templates.js");
const { addBlocker } = await import("../tasks/blockers.js");
const { deleteTask } = await import("../projects/purge.js");
const { serializeTask } = await import("../tasks/task-serialize.js");
const { resumeSession, runTask } = await import("./runner/manager.js");
const { wireFakeRunner } = await import("./runner/test-wiring.js");
// The resume port (06/09): `index.ts` wires it in production; a test ANSWERING an inbox entry must
// wire it itself, with the real implementation, which is what is tested.
const { registerSessionResumer } = await import("../inbox/ports.js");
registerSessionResumer({ resume: resumeSession, run: runTask });
const { describeTaskOutcome, findWaitCycle, requestWaitForTask, wakeWaitersOf } =
  await import("./wait-for-task.js");
// The branch the wake-up NAMES is the task's (slice nav/15): formatted here with the same function
// rather than copying a digest into an assertion.
const { branchKey, formatBranch } = await import("../tasks/task-branch.js");
const { SESSION_STATUS } = await import("./session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { ACTIVITY_FROM } = await import("../tasks/activity-enums.js");

const PROJECT = "p1";
const OTHER_PROJECT = "p2";
const AGENT = "a1";
const RUNNER = "r1";

type Spec = import("./runner/types.js").SessionSpec;
/** Every spec passed to a runner since the current test started: where what the woken agent
 *  REALLY receives in its conversation can be read. */
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
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: "p", createdAt: now }).run();
  db.insert(schema.projects)
    .values({ id: OTHER_PROJECT, name: "P2", slug: "p2", createdAt: now })
    .run();
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

function makeTask(id: string, over: Partial<typeof schema.tasks.$inferInsert> = {}) {
  const now = new Date();
  db.insert(schema.tasks)
    // Assigned: a resume goes through `loadContext`, which refuses a task without an agent
    // ("task has no assigned agent"), as in production.
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.todo,
      assigneeAgentId: AGENT,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .run();
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;
}

function makeSession(id: string, taskId: string, status: SessionStatus = "running") {
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
      sdkSessionId: "sdk-1",
      startedAt: new Date(),
    })
    .run();
}

const session = (id: string) =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()!;
const inboxOf = (sessionId: string) =>
  db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.sessionId, sessionId)).all();
const events = (sessionId: string) =>
  db.select().from(schema.sessionEvents).where(eq(schema.sessionEvents.sessionId, sessionId)).all();

describe("wait_for_task: setting the wait", () => {
  beforeEach(() => reset());

  it("pauses the session through the EXISTING inbox path (waiting), without a new status", () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    makeSession("s1", "A");

    const res = requestWaitForTask("s1", { taskId: "B", note: "I need its POST route" });
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.waiting, true);

    // The pause is the inbox's: same session status, same table, one more field.
    assert.equal(session("s1").status, SESSION_STATUS.waiting);
    const [msg] = inboxOf("s1");
    assert.equal(msg!.status, "open");
    assert.equal(msg!.waitForTaskId, "B");
    assert.match(msg!.body, /task B/);
    assert.match(msg!.body, /POST route/); // the agent's note is visible to the human
    // ...and the wait shows in the attention queue, not only in the database.
    const listed = listOpenInbox().find((i) => i.id === msg!.id)!;
    assert.equal(listed.waitForTaskId, "B");
    assert.equal(listed.waitForTaskName, "task B");
    assert.equal(listed.waitForTaskStatus, TASK_STATUS.todo);
    // ...and on the sleeping task's page ("waiting on task X for N min").
    const dto = serializeTask(
      db.select().from(schema.tasks).where(eq(schema.tasks.id, "A")).get()!,
    );
    assert.equal(dto.waitingFor?.waitForTaskId, "B");
    assert.equal(dto.waitingFor?.waitForTaskName, "task B");
    assert.ok(typeof dto.waitingFor?.since === "number");
    // The trace says who waits on what, in the session AND in the task activity thread.
    assert.ok(events("s1").some((e) => e.type === "dependency_wait"));
    const activity = db
      .select()
      .from(schema.taskActivity)
      .where(eq(schema.taskActivity.taskId, "A"))
      .all();
    assert.equal(activity.length, 1);
    assert.equal(activity[0]!.from, "system");
    assert.match(activity[0]!.body, /Waiting on task “task B”/);
  });

  it("target ALREADY done → immediate answer, no pause (no container destroyed for nothing)", () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B", { status: TASK_STATUS.done });
    db.insert(schema.taskActivity)
      .values({
        id: "act1",
        taskId: "B",
        from: ACTIVITY_FROM.agent,
        body: "API delivered: POST /api/x",
        createdAt: new Date(),
      })
      .run();
    makeSession("s1", "A");

    const res = requestWaitForTask("s1", { taskId: "B" });
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.waiting, false);
    assert.match(res.ok && !res.waiting ? res.result : "", /ALREADY done/);
    assert.match(res.ok && !res.waiting ? res.result : "", /POST \/api\/x/);
    assert.equal(session("s1").status, "running"); // no pause
    assert.equal(inboxOf("s1").length, 0); // no inbox entry for nothing
  });

  it("direct cycle (B already waits on A) → NAMED 409 refusal, not a silent deadlock", () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B", { status: TASK_STATUS.doing });
    makeSession("s1", "A");
    makeSession("s2", "B");

    assert.equal(requestWaitForTask("s2", { taskId: "A" }).ok, true); // B waits on A
    const res = requestWaitForTask("s1", { taskId: "B" }); // ...and A would wait on B
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.status, 409);
    const error = res.ok === false ? res.error : "";
    assert.match(error, /circular/);
    assert.match(error, /task A/); // BOTH tasks are named: the refusal can be fixed
    assert.match(error, /task B/);
    assert.equal(session("s1").status, "running"); // nothing was paused
  });

  it("cycle through a CHAIN (the target is blocked by the task that would wait on it) → 409", () => {
    // B is A's next step: it never starts while A is not done. If A's session sleeps on B, nobody
    // moves: the same deadlock, written differently.
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    addBlocker("B", "A");
    makeSession("s1", "A");

    const res = requestWaitForTask("s1", { taskId: "B" });
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.status, 409);
    assert.match(res.ok === false ? res.error : "", /chain/);
  });

  it("indirect cycle A → B → C → A → refused, and findWaitCycle returns the path", () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B", { status: TASK_STATUS.doing });
    makeTask("C", { status: TASK_STATUS.doing });
    makeSession("sb", "B");
    makeSession("sc", "C");
    assert.equal(requestWaitForTask("sb", { taskId: "C" }).ok, true); // B waits on C
    assert.equal(requestWaitForTask("sc", { taskId: "A" }).ok, true); // C waits on A

    const path = findWaitCycle("A", "B");
    assert.deepEqual(
      path?.map((s) => s.taskId),
      ["C", "A"],
    );

    makeSession("sa", "A");
    assert.equal(requestWaitForTask("sa", { taskId: "B" }).ok, false); // A cannot wait on B
  });

  it("one active wait per session (cap); waiting on itself is refused", () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    makeTask("C");
    makeSession("s1", "A");

    assert.equal(requestWaitForTask("s1", { taskId: "A" }).ok, false); // itself
    assert.equal(requestWaitForTask("s1", { taskId: "B" }).ok, true);
    const second = requestWaitForTask("s1", { taskId: "C" });
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.status, 409);
    assert.match(second.ok === false ? second.error : "", /already waiting/);
  });

  it("target from ANOTHER project, or missing → same 404 refusal (no leak between projects)", () => {
    makeTask("A", { status: TASK_STATUS.doing });
    const now = new Date();
    db.insert(schema.tasks)
      .values({
        id: "X",
        projectId: OTHER_PROJECT,
        name: "classified",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    makeSession("s1", "A");

    const foreign = requestWaitForTask("s1", { taskId: "X" });
    const missing = requestWaitForTask("s1", { taskId: "doesnotexist" });
    assert.equal(foreign.ok === false && foreign.status, 404);
    assert.equal(missing.ok === false && missing.status, 404);
    // The refusal reveals NEITHER the name NOR the existence of the other project's task.
    assert.doesNotMatch(foreign.ok === false ? foreign.error : "", /classified/);
  });

  it("a session no longer alive does not sleep (it would wake on nothing)", () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    makeSession("s1", "A", "destroyed");
    const res = requestWaitForTask("s1", { taskId: "B" });
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.status, 409);
  });
});

describe("wait_for_task: lifting the wait", () => {
  beforeEach(() => reset());

  it("the target goes done → the answer carries ITS result (branch, artifacts, report)", async () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B", {
      prUrls: JSON.stringify([{ repo: "legion", url: "https://github.com/x/y/pull/7" }]),
    });
    makeSession("s1", "A");
    requestWaitForTask("s1", { taskId: "B" });

    db.insert(schema.taskActivity)
      .values({
        id: "act1",
        taskId: "B",
        from: ACTIVITY_FROM.agent,
        body: "POST /api/x route delivered, branch pushed.",
        createdAt: new Date(),
      })
      .run();
    db.update(schema.tasks).set({ status: TASK_STATUS.done }).where(eq(schema.tasks.id, "B")).run();
    await wakeWaitersOf("B", TASK_STATUS.done);

    const [msg] = inboxOf("s1");
    assert.equal(msg!.status, "answered");
    assert.equal(msg!.answeredBy, "system"); // the trace says WHO woke it
    assert.match(msg!.answerText!, /POST \/api\/x route delivered/); // B's report
    assert.ok(msg!.answerText!.includes(formatBranch("chore", "task B", "B")), "its branch");
    assert.match(msg!.answerText!, /\/artifacts\/B/); // its artifacts
    assert.match(msg!.answerText!, /pull\/7/); // its PR
    assert.ok(events("s1").some((e) => e.type === "dependency_resolved"));
    // Task A's activity thread carries BOTH ends: falling asleep and waking up.
    const trace = db
      .select()
      .from(schema.taskActivity)
      .where(eq(schema.taskActivity.taskId, "A"))
      .all()
      .map((a) => a.body);
    assert.equal(trace.length, 2);
    assert.match(trace[1]!, /Automatic wake-up: .* is done/);
  });

  it("the wake-up goes through the EXISTING resume: the session restarts, and its prompt says why", async () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    makeSession("s1", "A");
    requestWaitForTask("s1", { taskId: "B" });
    assert.equal(session("s1").status, SESSION_STATUS.waiting);

    db.insert(schema.taskActivity)
      .values({
        id: "act1",
        taskId: "B",
        from: ACTIVITY_FROM.agent,
        body: "contract filed in /artifacts/B/contract.md",
        createdAt: new Date(),
      })
      .run();
    db.update(schema.tasks).set({ status: TASK_STATUS.done }).where(eq(schema.tasks.id, "B")).run();
    await wakeWaitersOf("B", TASK_STATUS.done);

    const spec = provisioned.at(-1)!;
    assert.equal(spec.sessionId, "s1");
    assert.equal(spec.resume?.sdkSessionId, "sdk-1"); // same conversation, context intact
    // The prompt does NOT claim a human answered, and it carries B's result.
    assert.doesNotMatch(spec.resume!.prompt, /The human answered your inbox question/);
    assert.match(spec.resume!.prompt, /woke you up automatically/);
    assert.match(spec.resume!.prompt, /contract\.md/);
  });

  it("target deletion → immediate, NAMED wake-up (the agent decides what next)", async () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    makeSession("s1", "A");
    requestWaitForTask("s1", { taskId: "B" });

    await wakeWaitersOf("B", "deleted");
    deleteTask("B");

    const [msg] = inboxOf("s1");
    assert.equal(msg!.status, "answered");
    assert.match(msg!.answerText!, /deleted/);
    assert.match(msg!.answerText!, /task B/);
    assert.match(provisioned.at(-1)!.resume!.prompt, /deleted/);
  });

  it("the human can answer BEFORE the system; the automatic wake-up then doubles nobody", async () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    makeSession("s1", "A");
    requestWaitForTask("s1", { taskId: "B" });
    const [msg] = inboxOf("s1");

    // Earlier wake-up, with the human's text ("drop it, do without").
    await answerInbox(msg!.id, { text: "Drop B, do without it and explain why." });
    assert.equal(
      db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, msg!.id)).get()!
        .answeredBy,
      "human",
    );
    assert.match(provisioned.at(-1)!.resume!.prompt, /The human answered your inbox question/);
    const resumesAfterHuman = provisioned.length;

    // B still finishes later: nobody left to wake, and certainly not twice.
    db.update(schema.tasks).set({ status: TASK_STATUS.done }).where(eq(schema.tasks.id, "B")).run();
    const woken = await wakeWaitersOf("B", TASK_STATUS.done);
    assert.deepEqual(woken, []);
    assert.equal(provisioned.length, resumesAfterHuman);
  });

  it("onTaskDone: the hook that already unblocks chains also wakes sleepers", async () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B");
    makeSession("s1", "A");
    requestWaitForTask("s1", { taskId: "B" });

    db.update(schema.tasks).set({ status: TASK_STATUS.done }).where(eq(schema.tasks.id, "B")).run();
    onTaskDone("B", settleDone("B")); // fire-and-forget inside
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(inboxOf("s1")[0]!.status, "answered");
  });

  it("describeTaskOutcome names a chain STEP's branch (run scope, not the step id)", () => {
    const step = makeTask("B", { status: TASK_STATUS.done, templateRunId: "run7", stepIndex: 1 });
    const text = describeTaskOutcome(step);
    // The branch key comes from the SCOPE, not the step: that is why all steps of a chain push to the
    // same place, and the artifacts folder tells the truth.
    assert.ok(text.includes(branchKey("run7")), `the run key is missing: ${text}`);
    assert.ok(!text.includes(branchKey("B")), "the step key must not name the branch");
    assert.match(text, /\/artifacts\/run7/);
  });
});

describe("wait_for_task: end to end (mock session)", () => {
  beforeEach(() => reset());

  it("A sleeps on B → B goes done → A resumes and READS the result in its conversation", async () => {
    makeTask("A", { status: TASK_STATUS.doing });
    makeTask("B", { status: TASK_STATUS.doing });
    makeSession("sA", "A");
    makeSession("sB", "B");

    // 1. A's agent hits a dependency and falls asleep.
    const asked = requestWaitForTask("sA", {
      taskId: "B",
      note: "I need the API before wiring the screen",
    });
    assert.equal(asked.ok && asked.waiting, true);
    assert.equal(session("sA").status, SESSION_STATUS.waiting); // container destroyed → zero cost
    assert.equal(provisioned.length, 0); // nothing restarted yet

    // 2. B's agent finishes its work and reports.
    db.insert(schema.taskActivity)
      .values({
        id: "actB",
        taskId: "B",
        from: ACTIVITY_FROM.agent,
        body: "POST /api/models/probe in place, merged.",
        createdAt: new Date(),
      })
      .run();
    db.update(schema.tasks).set({ status: TASK_STATUS.done }).where(eq(schema.tasks.id, "B")).run();
    onTaskDone("B", settleDone("B"));
    await new Promise((r) => setTimeout(r, 50));

    // 3. A restarted on its own, in ITS conversation, with B's result in front of it.
    const resumed = provisioned.find((s) => s.sessionId === "sA")!;
    assert.ok(resumed, "session A must have been restarted");
    assert.equal(resumed.resume?.sdkSessionId, "sdk-1");
    assert.match(resumed.resume!.prompt, /POST \/api\/models\/probe in place/);
    assert.equal(
      db.select().from(schema.sessions).where(eq(schema.sessions.id, "sA")).get()!.resumeCount,
      1,
    );
    // ...and the wait lingers nowhere: nothing left open in the queue.
    assert.equal(listOpenInbox().length, 0);
  });
});
