// The `/internal` port on what the breakdown spec adds: a task carrying criteria is a GATED STEP,
// and an agent may file a REMAINDER carrying some. That is the seam the spec names ("the internal
// API through which a session changes its task's status"), so tests go through Hono, with the
// callback token and the bodies the runtime really sends, never through the service alone.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { TaskStatus } from "../tasks/lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "legion-internal-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerInternalRoutes } = await import("./internal-routes.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const app = new Hono();
registerInternalRoutes(app);

const P1 = "p1",
  A1 = "a1",
  RUNNER = "r1",
  TASK = "t1",
  SESSION = "s1",
  TOKEN = "tok";

/** A slice as a batch approval sets it: command + two typed criteria. */
const CRITERIA = {
  validatedBy: "pnpm -s test",
  items: [
    { text: "validation names each fault", mode: "test" },
    { text: "the rank boundary is covered", mode: "property", edge: "B6/boundary" },
  ],
};

function seed(opts: { status?: TaskStatus; criteria?: unknown } = {}) {
  const now = new Date();
  // A template references the project: deleting it after would break the foreign key (the trap the
  // batch-approval block named in ITS hook, which holds for every following block).
  db.delete(schema.taskTemplates).run();
  db.delete(schema.inboxMessages).run();
  db.delete(schema.taskBlockers).run();
  db.delete(schema.taskActivity).run();
  // A PATCH publishes, a proposal notifies: both leave rows referencing the session or the task,
  // and a database reset must remove them first.
  db.delete(schema.sessionEvents).run();
  db.delete(schema.notices).run();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: A1,
      projectId: P1,
      name: "build",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: TASK,
      projectId: P1,
      name: "Slice 04 · criteria",
      status: opts.status ?? TASK_STATUS.doing,
      assigneeAgentId: A1,
      approvalGate: opts.criteria !== undefined,
      criteria: opts.criteria === undefined ? null : JSON.stringify(opts.criteria),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: TASK,
      agentId: A1,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: TOKEN,
      startedAt: now,
    })
    .run();
}

const patchTask = (body: unknown) =>
  app.request(`/internal/sessions/${SESSION}/task`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
const proposeTask = (body: unknown) =>
  app.request(`/internal/sessions/${SESSION}/propose-task`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
const postEvent = (body: unknown) =>
  app.request(`/internal/sessions/${SESSION}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
const postInbox = (body: unknown) =>
  app.request(`/internal/sessions/${SESSION}/inbox`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
const task = () => db.select().from(schema.tasks).where(eq(schema.tasks.id, TASK)).get()!;
const session = () =>
  db.select().from(schema.sessions).where(eq(schema.sessions.id, SESSION)).get()!;
const inboxRows = () => db.select().from(schema.inboxMessages).all();

describe("PATCH /internal/sessions/:id/task: a task with criteria is a gated step", () => {
  beforeEach(() => seed({ criteria: CRITERIA }));

  it("done is REFUSED, with the message that only the operator finishes, and the task does not move", async () => {
    const res = await patchTask({ status: TASK_STATUS.done });
    assert.equal(res.status, 403);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /only the operator finishes/);
    assert.equal(task().status, TASK_STATUS.doing);
  });

  it("review from doing passes: the path the agent MUST take", async () => {
    assert.equal((await patchTask({ status: TASK_STATUS.review })).status, 200);
    assert.equal(task().status, TASK_STATUS.review);
  });

  it("from review, doing is REFUSED with the message that the task waits for the operator", async () => {
    seed({ status: TASK_STATUS.review, criteria: CRITERIA });
    const res = await patchTask({ status: TASK_STATUS.doing });
    assert.equal(res.status, 403);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /waiting for the operator/);
    assert.equal(task().status, TASK_STATUS.review);
  });

  it("from review, review is ACCEPTED WITHOUT EFFECT: the row is not even touched", async () => {
    seed({ status: TASK_STATUS.review, criteria: CRITERIA });
    const before = task().updatedAt;
    const res = await patchTask({ status: TASK_STATUS.review });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(task().status, TASK_STATUS.review);
    assert.deepEqual(task().updatedAt, before);
  });

  it("filing a remainder stays possible from review: the note lands in the thread", async () => {
    seed({ status: TASK_STATUS.review, criteria: CRITERIA });
    assert.equal(
      (await patchTask({ status: TASK_STATUS.review, note: "PARTIAL 1/2" })).status,
      200,
    );
    const notes = db.select().from(schema.taskActivity).all();
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.body, "PARTIAL 1/2");
  });

  it("WITHOUT criteria nothing changes: the agent finishes its task as before", async () => {
    seed();
    assert.equal((await patchTask({ status: TASK_STATUS.done })).status, 200);
    assert.equal(task().status, TASK_STATUS.done);
  });
});

describe("POST /internal/sessions/:id/propose-task: the remainder of a partial slice", () => {
  beforeEach(() => seed({ criteria: CRITERIA }));

  it("a proposal WITH criteria creates a task carrying them, and a gate", async () => {
    const res = await proposeTask({
      name: "Remainder of slice 04",
      brief: "the unmet criteria",
      blocking: true,
      criteria: { validatedBy: "pnpm -s test", items: [{ text: "the rest", mode: "test" }] },
    });
    assert.equal(res.status, 201);
    const created = db
      .select()
      .from(schema.tasks)
      .all()
      .find((t) => t.id !== TASK)!;
    assert.equal(created.approvalGate, true);
    assert.deepEqual(JSON.parse(created.criteria!), {
      validatedBy: "pnpm -s test",
      items: [{ text: "the rest", mode: "test" }],
    });
    // The three proposal guardrails hold: `later`, never assigned, out of the queue.
    assert.equal(created.status, TASK_STATUS.later);
    assert.equal(created.assigneeAgentId, null);
    // `blocking`: the partial slice waits for its remainder.
    assert.deepEqual(
      db
        .select()
        .from(schema.taskBlockers)
        .all()
        .map((b) => [b.taskId, b.blockerId]),
      [[TASK, created.id]],
    );
  });

  it("a proposal with FAULTY criteria is refused naming them ALL, and nothing is created", async () => {
    const res = await proposeTask({
      name: "Remainder",
      brief: "b",
      criteria: { validatedBy: " ", items: [{ text: "", mode: "eyeball" }] },
    });
    assert.equal(res.status, 400);
    const { error } = (await res.json()) as { error: string };
    assert.equal(
      error,
      "invalid criteria: empty validation command · criterion 1: empty text, unknown mode “eyeball”",
    );
    assert.equal(db.select().from(schema.tasks).all().length, 1);
  });

  it("a proposal WITHOUT criteria stays what it was: no gate", async () => {
    const res = await proposeTask({ name: "A bug seen in passing", brief: "b" });
    assert.equal(res.status, 201);
    const created = db
      .select()
      .from(schema.tasks)
      .all()
      .find((t) => t.id !== TASK)!;
    assert.equal(created.approvalGate, false);
    assert.equal(created.criteria, null);
  });
});

// The boundary (05/09). An agent body reached `createInboxMessage` through a spread, and the service
// reads three fields there that belong to the control plane: `reason` (an agent-set
// `operator-pause` suppressed the human notification), `wakeAt`, `waitForTaskId`. Tested through
// the route, with the token, because the route is the judge.
describe("POST /internal/sessions/:id/inbox: the body is judged at the boundary", () => {
  beforeEach(() => seed());

  it("happy path unchanged: `inboxId` returned, the question is open, the session waits", async () => {
    const res = await postInbox({
      kind: "choice",
      body: "How do we continue?",
      choices: [{ id: "a", label: "A" }],
      evidence: "read: x.ts:12",
      impact: "touches x.ts",
    });
    assert.equal(res.status, 201);
    const { inboxId } = (await res.json()) as { ok: true; inboxId: string };
    const [row] = inboxRows();
    assert.equal(row?.id, inboxId);
    assert.equal(row?.kind, "choice");
    assert.equal(row?.reason, "question");
    assert.equal(session().status, "waiting");
  });

  it("`reason`, `wakeAt`, `waitForTaskId` set by the agent are REFUSED with a named 400, nothing is created", async () => {
    const res = await postInbox({
      kind: "text",
      body: "I keep quiet",
      reason: "operator-pause",
      wakeAt: "2030-01-01T00:00:00Z",
      waitForTaskId: "t-other",
    });
    assert.equal(res.status, 400);
    const { error } = (await res.json()) as { error: string };
    assert.equal(error, 'invalid body: Unrecognized keys: "reason", "wakeAt", "waitForTaskId"');
    assert.equal(inboxRows().length, 0);
    assert.equal(session().status, "running");
  });

  it("an unknown `kind` is refused with 400, listing the allowed values", async () => {
    const res = await postInbox({ kind: "poem", body: "x" });
    assert.equal(res.status, 400);
    const { error } = (await res.json()) as { error: string };
    assert.equal(
      error,
      'invalid body: kind — Invalid option: expected one of "text"|"choice"|"form"',
    );
    assert.equal(inboxRows().length, 0);
  });

  it("an empty body is still refused", async () => {
    const res = await postInbox({ kind: "text", body: "   " });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /body required/);
  });
});

describe("the other /internal bodies are judged the same way", () => {
  beforeEach(() => seed());

  it("PATCH task: a status outside the list no longer reaches the database", async () => {
    const res = await patchTask({ status: "shipped" });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /^invalid body: status — /);
    assert.equal(task().status, TASK_STATUS.doing);
  });

  it("propose-task: an unknown key is refused by name, and nothing is created", async () => {
    const res = await proposeTask({ name: "x", brief: "b", assigneeAgentId: A1 });
    assert.equal(res.status, 400);
    assert.equal(
      ((await res.json()) as { error: string }).error,
      'invalid body: Unrecognized key: "assigneeAgentId"',
    );
    assert.equal(db.select().from(schema.tasks).all().length, 1);
  });
});

describe("PATCH /internal/sessions/:id/task: a batch-approving step does not end here", () => {
  const TPL = "tpl-1";
  beforeEach(() => {
    // Before `seed`, which deletes projects: a template references them, and deleting it after would
    // break the foreign key on the hook's second pass.
    db.delete(schema.taskTemplates).run();
    seed({ status: TASK_STATUS.doing }); // no criteria: the `approvesLot` flag must refuse
    db.insert(schema.taskTemplates)
      .values({
        id: TPL,
        projectId: P1,
        name: "feature",
        autoRunNext: false,
        createdAt: new Date(),
        steps: JSON.stringify([
          {
            name: "Breakdown",
            agentName: "slicer",
            approvalGate: true,
            approvesLot: true,
            expectedArtifacts: [],
            prompt: "p",
          },
        ]),
      })
      .run();
    db.update(schema.tasks)
      .set({ templateId: TPL, stepIndex: 0, templateRunId: "run-1", approvalGate: false })
      .where(eq(schema.tasks.id, TASK))
      .run();
  });

  it("done is refused, saying only the batch approval ends the step", async () => {
    const res = await patchTask({ status: TASK_STATUS.done });
    assert.equal(res.status, 403);
    const { error } = (await res.json()) as { error: string };
    assert.match(error, /approving the batch/);
    assert.equal(task().status, TASK_STATUS.doing);
  });

  it("review stays the agent's path: that is where the operator approves", async () => {
    assert.equal((await patchTask({ status: TASK_STATUS.review })).status, 200);
    assert.equal(task().status, TASK_STATUS.review);
  });
});

// A session's cost is the sum of its runs (10/09).
//
// The SDK bills each `query()` separately: a `set()` of the last `total_cost_usd` erased the
// previous ones, and a resumed session's row only carried its last resume. Measured on
// `RPXUHq0upSK-`: $0.94, then $0, then $3.40, a row at $3.40 for $4.35 spent.
//
// Adding moves the risk: a re-sent frame, which the runtime sends out of caution, would add its
// cost twice. Hence the write comes AFTER the duplicate guard, which this block's second case
// holds.
describe("POST /internal/sessions/:id/events: cost adds up, a duplicate adds nothing", () => {
  beforeEach(() => seed());

  const result = (costUsd: number, seq: number) =>
    postEvent({ type: "result", seq, payload: { subtype: "success", costUsd, numTurns: 1 } });

  it("sums the runs, and publishes the TASK total in the event", async () => {
    await result(0.941514, 1);
    await result(0, 2);
    const res = await result(3.4044492, 3);
    assert.equal(res.status, 200);
    assert.ok(Math.abs((session().costUsd ?? 0) - 4.3459632) < 1e-9);
    const rows = db.select().from(schema.sessionEvents).all();
    const last = JSON.parse(rows[rows.length - 1]!.payload) as { taskCostUsd: number };
    assert.equal(last.taskCostUsd, 4.346);
  });

  it("a re-sent frame does not count twice", async () => {
    await result(1.5, 1);
    const res = await result(1.5, 1);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { duplicate?: boolean }).duplicate, true);
    assert.equal(session().costUsd, 1.5);
  });

  it("an event without cost does not touch the row", async () => {
    await result(2, 1);
    await postEvent({ type: "text", seq: 2, payload: { text: "at work" } });
    assert.equal(session().costUsd, 2);
  });
});
