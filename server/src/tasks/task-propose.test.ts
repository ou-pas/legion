// What this file protects:
//
//  1. a proposal always creates a task in `later`, never `todo`/`doing`, and always out of the queue
//     (`queued: false`): the only path `propose_task` may take;
//  2. it never assigns (`assigneeAgentId` stays NULL even when `agentName` is given: a text
//     suggestion, not an assignment);
//  3. provenance (session + origin task) is traced on the created row: the link the boundary relay
//     (23/08) uses to point at the filed contract;
//  4. the per-session cap refuses (429) beyond PROPOSAL_CAP_PER_SESSION, by name, never creating the
//     extra task;
//  5. refusals (400/404) are named and write nothing;
//  6. `blocking` writes a dependency on the origin task without touching the first three invariants,
//     and adds to an existing dependency instead of replacing it.
//
// Real temporary SQLite, like task-edit.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-task-propose-"));
process.env.LEGION_DB = join(dir, "test.db");
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { proposeTask, PROPOSAL_CAP_PER_SESSION, PROPOSAL_NAME_MAX, PROPOSAL_BRIEF_MAX } =
  await import("./task-propose.js");
const { addBlocker, blockersOf } = await import("./blockers.js");
const { TASK_STATUS } = await import("./lifecycle.js");
const { COMPLEXITY } = await import("./task-scales.js");
const { RUNNER_KIND } = await import("../shared/enums.js");

const P1 = "p1";
const A1 = "a1";
const RUNNER = "r1";
const ORIGIN_TASK = "t-origin";
const SESSION = "s1";

function reset() {
  const now = new Date();
  db.delete(schema.sessions).run();
  db.delete(schema.tasks).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.delete(schema.runners).run();
  db.insert(schema.projects).values({ id: P1, name: "P1", slug: "p1", createdAt: now }).run();
  db.insert(schema.agents)
    .values({ id: A1, projectId: P1, name: "a1", rolePrompt: "r", createdAt: now })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: "r1", kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: ORIGIN_TASK,
      projectId: P1,
      name: "task in progress",
      status: TASK_STATUS.doing,
      assigneeAgentId: A1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.sessions)
    .values({
      id: SESSION,
      taskId: ORIGIN_TASK,
      agentId: A1,
      runnerId: RUNNER,
      model: "sonnet",
      status: "running",
      callbackToken: "tok",
      startedAt: now,
    })
    .run();
}

const taskRow = (id: string) => db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
const allTasks = () => db.select().from(schema.tasks).all();

describe("proposeTask", () => {
  beforeEach(() => reset());

  it("creates the task in `later`, out of the queue, with the requested complexity", () => {
    const r = proposeTask(SESSION, {
      name: "Web relay: probe contract",
      brief: "See contract-probe-endpoint.md",
      complexity: COMPLEXITY.high,
    });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.task.status, TASK_STATUS.later);
    assert.equal(r.task.queued, false);
    assert.equal(r.task.complexity, "high");
    assert.equal(taskRow(r.task.id)?.status, TASK_STATUS.later);
  });

  it("default complexity: `med`", () => {
    const r = proposeTask(SESSION, { name: "n", brief: "b" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.task.complexity, "med");
  });

  it("never assigns: agentName is only a suggestion traced separately", () => {
    const r = proposeTask(SESSION, { name: "n", brief: "b", agentName: "a1" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.task.assigneeAgentId, null);
    assert.equal(r.task.proposedAgentName, "a1");
  });

  // 24/08: three proposals on 23/08 suggested "web" and "senior-dev-web", two non-existent agents.
  // Harmless (never an assignment) but misleading for the human reading the card.
  it("an agent unknown to the project: suggestion dropped, task still created, agent warned", () => {
    const r = proposeTask(SESSION, { name: "n", brief: "b", agentName: "senior-dev-web" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.task.proposedAgentName, null, "no ghost name on the card");
    assert.match(r.warning ?? "", /senior-dev-web/);
    assert.match(r.warning ?? "", /a1/, "the warning names the valid agents");
  });

  it("the project's case wins, not the agent's", () => {
    const r = proposeTask(SESSION, { name: "n", brief: "b", agentName: "A1" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.task.proposedAgentName, "a1");
    assert.equal(r.warning, undefined);
  });

  it("an unknown suggestion never loses the proposal", () => {
    const r = proposeTask(SESSION, { name: "finding", brief: "b", agentName: "ghost" });
    assert.ok(r.ok, "the task is worth more than its suggestion");
    if (!r.ok) return;
    assert.equal(r.task.name, "finding");
    assert.equal(r.task.status, TASK_STATUS.later);
  });

  it("traces provenance: session and origin task", () => {
    const r = proposeTask(SESSION, { name: "n", brief: "b" });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.task.proposedByAgent, true);
    assert.equal(r.task.proposedBySessionId, SESSION);
    assert.equal(r.task.proposedFromTaskId, ORIGIN_TASK);
    assert.equal(r.task.projectId, P1); // inherited from the origin task
  });

  it("empty name → 400, nothing created", () => {
    const before = allTasks().length;
    const r = proposeTask(SESSION, { name: "   ", brief: "b" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400);
    assert.equal(allTasks().length, before);
  });

  it("empty brief → 400, nothing created", () => {
    const before = allTasks().length;
    const r = proposeTask(SESSION, { name: "n", brief: "  " });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400);
    assert.equal(allTasks().length, before);
  });

  it("name too long → 400 naming the length and the maximum", () => {
    const r = proposeTask(SESSION, { name: "x".repeat(PROPOSAL_NAME_MAX + 1), brief: "b" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && r.error.includes(String(PROPOSAL_NAME_MAX)));
  });

  it("brief too long → 400 naming the length and the maximum", () => {
    const r = proposeTask(SESSION, { name: "n", brief: "x".repeat(PROPOSAL_BRIEF_MAX + 1) });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400 && r.error.includes(String(PROPOSAL_BRIEF_MAX)));
  });

  it("a whole spec fits: the cap is 20,000, not 8,000", () => {
    // D11 (/artifacts/rtQLldYSm2/spec.md): since discussion mode, the filed brief is the spec; a task
    // cannot read another's artifacts, but always reads its own brief. The number is asserted
    // hard-coded on purpose: lowering it without deciding would silently condense specs again, and
    // the loss would only show at the next task.
    assert.equal(PROPOSAL_BRIEF_MAX, 20_000);
    const r = proposeTask(SESSION, { name: "implementation", brief: "x".repeat(20_000) });
    assert.equal(r.ok, true);
  });

  it("invalid complexity → 400", () => {
    // @ts-expect-error deliberate: simulates a malformed MCP call
    const r = proposeTask(SESSION, { name: "n", brief: "b", complexity: "urgent" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 400);
  });

  it("missing session → 404", () => {
    const r = proposeTask("s-unknown", { name: "n", brief: "b" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 404);
  });

  it(`per-session cap: proposal ${PROPOSAL_CAP_PER_SESSION + 1} is refused (429), nothing extra created`, () => {
    for (let i = 0; i < PROPOSAL_CAP_PER_SESSION; i++) {
      const r = proposeTask(SESSION, { name: `n${i}`, brief: "b" });
      assert.ok(r.ok, `proposal ${i} should have passed`);
    }
    const before = allTasks().length;
    const r = proposeTask(SESSION, { name: "one too many", brief: "b" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.status === 429);
    assert.equal(allTasks().length, before);
  });

  it("the cap is per session: another session of the same agent keeps its own counter", () => {
    for (let i = 0; i < PROPOSAL_CAP_PER_SESSION; i++)
      assert.ok(proposeTask(SESSION, { name: `n${i}`, brief: "b" }).ok);

    const other = "s2";
    db.insert(schema.sessions)
      .values({
        id: other,
        taskId: ORIGIN_TASK,
        agentId: A1,
        runnerId: RUNNER,
        model: "sonnet",
        status: "running",
        callbackToken: "tok2",
        startedAt: new Date(),
      })
      .run();
    const r = proposeTask(other, { name: "n", brief: "b" });
    assert.ok(r.ok);
  });
});

// `blocking` (25/08): "this must go first", the case the tool could not express. What follows mostly
// checks what it does not do: the filed task stays `later` and unassigned, exactly as without the
// flag. It moves a dependency, not a guardrail.
describe("proposeTask: the prerequisite", () => {
  beforeEach(() => reset());

  it("blocks the origin task by the filed task", () => {
    const res = proposeTask(SESSION, {
      name: "API routes",
      brief: "no route exists",
      blocking: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.blocked, true);
    assert.deepEqual(blockersOf(ORIGIN_TASK), [res.task.id]);
  });

  it("launches and assigns nothing for all that: the three guardrails hold", () => {
    const res = proposeTask(SESSION, {
      name: "API routes",
      brief: "b",
      agentName: "a1",
      blocking: true,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.task.status, TASK_STATUS.later);
    assert.equal(res.task.queued, false);
    assert.equal(
      res.task.assigneeAgentId,
      null,
      "a prerequisite is no more assigned than any other proposal",
    );
    assert.equal(res.task.proposedAgentName, "a1", "the suggestion stays a suggestion");
  });

  it("without the flag nothing is blocked: the default does not change", () => {
    const res = proposeTask(SESSION, { name: "extra", brief: "b" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.blocked, false);
    assert.deepEqual(blockersOf(ORIGIN_TASK), []);
  });

  it("adds to an existing dependency: the origin task waits for both", () => {
    const now = new Date();
    db.insert(schema.tasks)
      .values({
        id: "other",
        projectId: P1,
        name: "origin blocker",
        status: TASK_STATUS.todo,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    addBlocker(ORIGIN_TASK, "other");

    const res = proposeTask(SESSION, { name: "API routes", brief: "b", blocking: true });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.blocked, true);
    assert.deepEqual(
      blockersOf(ORIGIN_TASK).sort(),
      ["other", res.task.id].sort(),
      "the original dependency survives, the new one adds to it",
    );
    assert.equal(res.warning, undefined, "nothing to warn: nothing was replaced");
  });
});

// `blockerIds` (08/09): order between filings, the edge `blocking` could not express. What revealed
// it: an interview filing four tasks, one waiting for the other three, with no way to write it. The
// module's fourth guardrail is here: you only order what you filed yourself; a dependency on a
// project task stays the operator's gesture.
describe("proposeTask: order between filings", () => {
  beforeEach(() => reset());

  const deposit = (name: string, blockerIds?: string[]) =>
    proposeTask(SESSION, {
      name,
      brief: `brief of ${name}`,
      ...(blockerIds ? { blockerIds } : {}),
    });

  it("orders two filings of the same session", () => {
    const first = deposit("translate the home page");
    assert.ok(first.ok);
    if (!first.ok) return;
    const second = deposit("review the translations", [first.task.id]);
    assert.ok(second.ok);
    if (!second.ok) return;
    assert.deepEqual(blockersOf(second.task.id), [first.task.id]);
    assert.deepEqual(blockersOf(first.task.id), [], "the prerequisite waits for nobody");
  });

  it("accepts several prerequisites: the review waits for all three", () => {
    const ids = ["home", "account", "operations"].map((n) => {
      const r = deposit(n);
      assert.ok(r.ok);
      return r.ok ? r.task.id : "";
    });
    const last = deposit("review the translations", ids);
    assert.ok(last.ok);
    if (!last.ok) return;
    assert.deepEqual(blockersOf(last.task.id).sort(), [...ids].sort());
  });

  it("leaves the first three invariants intact: `later`, out of the queue, unassigned", () => {
    const first = deposit("prerequisite");
    assert.ok(first.ok);
    if (!first.ok) return;
    const second = proposeTask(SESSION, {
      name: "dependent",
      brief: "b",
      agentName: "a1",
      blockerIds: [first.task.id],
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    assert.equal(second.task.status, TASK_STATUS.later);
    assert.equal(second.task.queued, false);
    assert.equal(second.task.assigneeAgentId, null);
  });

  it("refuses a task this session did not file, naming it", () => {
    const res = deposit("dependent", [ORIGIN_TASK]);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
    assert.match(res.error, /proposed by this session/);
    assert.match(res.error, new RegExp(ORIGIN_TASK));
    assert.equal(allTasks().length, 1, "a refusal writes nothing: only the origin task remains");
  });

  it("refuses another session's filing, even in the same project", () => {
    const now = new Date();
    db.insert(schema.sessions)
      .values({
        id: "s2",
        taskId: ORIGIN_TASK,
        agentId: A1,
        runnerId: RUNNER,
        model: "sonnet",
        status: "running",
        callbackToken: "tok2",
        startedAt: now,
      })
      .run();
    const theirs = proposeTask("s2", { name: "their filing", brief: "b" });
    assert.ok(theirs.ok);
    if (!theirs.ok) return;

    const res = deposit("dependent", [theirs.task.id]);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
  });

  it("refuses an already finished prerequisite: a link with no event left to consume", () => {
    const first = deposit("prerequisite");
    assert.ok(first.ok);
    if (!first.ok) return;
    db.update(schema.tasks)
      .set({ status: TASK_STATUS.done })
      .where(eq(schema.tasks.id, first.task.id))
      .run();

    const res = deposit("dependent", [first.task.id]);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.status, 400);
    assert.match(res.error, /already done/);
    assert.equal(allTasks().length, 2, "the refusal did not create the dependent");
  });

  it("deduplicates, and ignores an empty list", () => {
    const first = deposit("prerequisite");
    assert.ok(first.ok);
    if (!first.ok) return;
    const second = deposit("dependent", [first.task.id, first.task.id]);
    assert.ok(second.ok);
    if (!second.ok) return;
    assert.deepEqual(blockersOf(second.task.id), [first.task.id]);

    const third = deposit("unordered", []);
    assert.ok(third.ok);
    if (!third.ok) return;
    assert.deepEqual(blockersOf(third.task.id), []);
  });

  it("combines with `blocking`: the interview waits for its filing, which waits for its prerequisite", () => {
    const first = deposit("prerequisite");
    assert.ok(first.ok);
    if (!first.ok) return;
    const second = proposeTask(SESSION, {
      name: "implementation",
      brief: "b",
      blocking: true,
      blockerIds: [first.task.id],
    });
    assert.ok(second.ok);
    if (!second.ok) return;
    assert.deepEqual(blockersOf(ORIGIN_TASK), [second.task.id]);
    assert.deepEqual(blockersOf(second.task.id), [first.task.id]);
  });
});
