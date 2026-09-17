// The orchestration loop itself, which had no test. `goal-delete.test.ts` and `goal-edit.test.ts`
// enter through the routes and never run a round. The loop was covered by ricochet at 54% of lines,
// and that is not enough for code that runs unwatched in the background and whose failures show
// hours later on a goal that no longer moves.
//
// Four promises, in the order they cost something:
//  1. The prompt contains no code. An enum rename (05/09) replaced the word `done` with
//     `TASK_STATUS.done` inside the instruction sent to the model. Nothing re-read that string: it
//     compiles, it ships, and the orchestrator gets a TypeScript identifier instead of an English
//     word. The test refuses any `X_STATUS.` in the built prompt.
//  2. A goal deleted under the loop's feet. The round reads the goal once at the start; before, ten
//     `goalRow(goalId)!` re-read it through the body, each turning "deleted mid-round" (a case the
//     `runGoalLoop` net names) into a `TypeError`. The loop must exit without writing orphans and
//     without resurrecting the row.
//  3. Cost charging. A session killed at timeout never emits `result`, so `costUsd` stays null: it
//     counts at the average cost of billed sessions. The condition is on `SESSION_STATUS.failed` (a
//     session row, not a goal row); both families serialise `"failed"` the same way, so no test
//     could tell them apart before this one, which pins the intended semantics (a `failed` is
//     charged, a `destroyed` is not).
//  4. A multi-task batch settles in one pass. Three `inArray` queries for the whole batch replaced
//     three per task. The risk of such grouping is mixing, not slowness: the test gives each task a
//     different cost and note and checks each gets its own back.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(join(tmpdir(), "legion-goals-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
// Without a credential a goal is `mock`: `generateDod` and `decide` then have a deterministic
// offline path, which makes the loop testable for real.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const {
  approveDod,
  buildDecisionPrompt,
  generateDod,
  goalDetail,
  killGoal,
  listGoals,
  pauseGoal,
  recoverGoals,
  resumeGoal,
  runGoalLoop,
  serializeGoal,
} = await import("./goals.js");
const { GOAL_STATUS } = await import("./goal-status.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { PRIORITY } = await import("../tasks/task-scales.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { ACTIVITY_FROM } = await import("../tasks/activity-enums.js");

type GoalLoopDeps = import("./goals.js").GoalLoopDeps;
type Decision = import("./goals.js").Decision;
type DodItem = import("./goals.js").DodItem;
type SessionStatus = import("../sessions/session-terminal.js").SessionStatus;

const PROJECT = "p-goals";
const DEMO = "p-demo";
const AGENT_DEV = "a-dev";
const AGENT_QA = "a-qa";
const RUNNER = "r-goals";
const GOAL = "g1";
const OUTSIDER = "t-outside-goal"; // a task with no goal: it carries the already billed sessions

const now = new Date();

function reset(): void {
  db.delete(schema.sessions).run();
  db.delete(schema.taskActivity).run();
  db.delete(schema.tasks).run();
  db.delete(schema.goalEvents).run();
  db.delete(schema.goals).run();
  db.delete(schema.agents).run();
  db.delete(schema.runners).run();
  db.delete(schema.webhooks).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects)
    .values({ id: PROJECT, name: "P", slug: "pgoals", createdAt: now })
    .run();
  db.insert(schema.projects)
    .values({ id: DEMO, name: "D", slug: "pdemo", demo: true, createdAt: now })
    .run();
  db.insert(schema.agents)
    .values({
      id: AGENT_DEV,
      projectId: PROJECT,
      name: "dev",
      title: "develops",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.agents)
    .values({
      id: AGENT_QA,
      projectId: PROJECT,
      name: "qa",
      title: "reviews",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.runners).values({ id: RUNNER, name: RUNNER, kind: RUNNER_KIND.process }).run();
  db.insert(schema.tasks)
    .values({
      id: OUTSIDER,
      projectId: PROJECT,
      name: "outside goal",
      status: TASK_STATUS.done,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

type GoalOverrides = Partial<typeof schema.goals.$inferInsert>;

function makeGoal(over: GoalOverrides = {}, id = GOAL): string {
  db.insert(schema.goals)
    .values({
      id,
      projectId: PROJECT,
      name: "goal",
      request: "do the thing",
      status: GOAL_STATUS.active,
      mock: true,
      startedAt: now,
      createdAt: now,
      dod: JSON.stringify([{ id: "d1", text: "the artifact exists", done: false }]),
      plan: JSON.stringify([{ step: "produce", agentName: "dev", why: "because" }]),
      ...over,
    })
    .run();
  return id;
}

const goalRow = (id = GOAL) => db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
const goalEvents = (type?: string, id = GOAL) =>
  db
    .select()
    .from(schema.goalEvents)
    .where(eq(schema.goalEvents.goalId, id))
    .all()
    .filter((e) => !type || e.type === type)
    .map((e) => ({ type: e.type, payload: JSON.parse(e.payload) as Record<string, unknown> }));
const goalTasks = (id = GOAL) =>
  db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.goalId, id))
    .all()
    .sort((a, b) => a.boardOrder - b.boardOrder);
const dodOf = (id = GOAL) => JSON.parse(goalRow(id)?.dod ?? "[]") as DodItem[];

/** The four gestures the loop cannot make in a test: decide (the SDK), start a container, kill
 *  one, wait in real seconds. The "decides to stop" default keeps a forgotten test from polling for
 *  thirty minutes. */
function deps(over: Partial<GoalLoopDeps> = {}): GoalLoopDeps {
  return {
    decide: async () => ({ action: "stop", progressMade: false, reason: "end of script" }),
    runTask: async () => "s-inert",
    stopSession: async () => {},
    sleep: async () => {},
    ...over,
  };
}

/** Decisions played in order, then a `stop`: a test loop must end. */
function scripted(...decisions: Decision[]): GoalLoopDeps["decide"] {
  const queue = [...decisions];
  return async () =>
    queue.shift() ?? { action: "stop", progressMade: false, reason: "script exhausted" };
}

const spawnOne = (instruction = "produce the artifact"): Decision => ({
  action: "spawn",
  agentName: "dev",
  instruction,
  progressMade: true,
  reason: "at work",
});

/** A test `runTask` inserts the session the real runner would have created, in the wanted state:
 *  that is all the loop needs from it, since it only ever reads the `sessions` table. */
function runTaskPosting(
  sessions: { status: SessionStatus; costUsd?: number | null }[],
): GoalLoopDeps["runTask"] {
  let n = 0;
  return async (taskId: string) => {
    const spec = sessions[Math.min(n, sessions.length - 1)] ?? { status: SESSION_STATUS.destroyed };
    const id = `s-${++n}`;
    db.insert(schema.sessions)
      .values({
        id,
        taskId,
        agentId: AGENT_DEV,
        runnerId: RUNNER,
        model: "sonnet",
        callbackToken: `tok-${id}`,
        status: spec.status,
        costUsd: spec.costUsd ?? null,
        startedAt: now,
      })
      .run();
    return id;
  };
}

/** Already billed sessions outside the goal: the fallback average comes from them. */
function billedSessions(...costs: number[]): void {
  costs.forEach((costUsd, i) => {
    db.insert(schema.sessions)
      .values({
        id: `s-billed-${i}`,
        taskId: OUTSIDER,
        agentId: AGENT_DEV,
        runnerId: RUNNER,
        model: "sonnet",
        callbackToken: `tok-billed-${i}`,
        status: SESSION_STATUS.destroyed,
        costUsd,
        startedAt: now,
      })
      .run();
  });
}

beforeEach(reset);

describe("the orchestrator prompt", () => {
  const prompt = () =>
    buildDecisionPrompt(
      { id: "g-abc", request: "deliver the thing" },
      {
        dod: [{ id: "d1", text: "the artifact exists", done: false }],
        plan: [{ step: "produce", agentName: "dev", why: "because" }],
        agents: [{ name: "dev", title: "develops" }],
        recentLog: "decision: {}",
      },
    );

  it("contains no enum identifier: this is text for a model, not TypeScript", () => {
    const matches = prompt().match(/[A-Z][A-Z_]*_STATUS\.[A-Za-z]+/g);
    assert.equal(
      matches,
      null,
      `enum identifier(s) leaked into the prompt: ${matches?.join(", ")}`,
    );
  });

  it("states the rule the enum had overwritten: a criterion is only met at status done", () => {
    assert.match(
      prompt(),
      /is only done when the log shows a task you spawned actually reached status done/,
    );
  });

  it("names the goal's shared folder in both artifact instructions", () => {
    assert.equal(prompt().match(/\/artifacts\/g-abc/g)?.length, 2);
  });

  it("omits the plan section when the goal has none", () => {
    const sansPlan = buildDecisionPrompt(
      { id: "g", request: "r" },
      { dod: [], plan: [], agents: [], recentLog: "" },
    );
    assert.ok(!sansPlan.includes("Approved provisional plan"));
    assert.match(sansPlan, /\(none yet\)/);
  });
});

describe("a goal deleted under the loop's feet", () => {
  /** Deletion as `goal-delete.ts` does it: children first (FKs are ON). */
  function deleteGoal(id = GOAL): void {
    const ids = db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.goalId, id))
      .all();
    for (const t of ids) {
      db.delete(schema.sessions).where(eq(schema.sessions.taskId, t.id)).run();
      db.delete(schema.taskActivity).where(eq(schema.taskActivity.taskId, t.id)).run();
    }
    db.delete(schema.tasks).where(eq(schema.tasks.goalId, id)).run();
    db.delete(schema.goalEvents).where(eq(schema.goalEvents.goalId, id)).run();
    db.delete(schema.goals).where(eq(schema.goals.id, id)).run();
  }

  it("exits cleanly while waiting on the batch, without throwing or writing orphans", async () => {
    makeGoal();
    let stopped = 0;
    // The row goes during the first poll, when the loop has the most reasons to re-read a goal that
    // no longer exists.
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(spawnOne()),
        runTask: runTaskPosting([{ status: SESSION_STATUS.running }]),
        stopSession: async () => {
          stopped += 1;
        },
        sleep: async () => {
          deleteGoal();
        },
      }),
    );

    assert.equal(goalRow(), undefined, "the loop resurrected the deleted row");
    assert.equal(goalEvents().length, 0, "an orphan event was written after deletion");
    assert.equal(stopped, 0, "the loop kept driving sessions of a vanished goal");
  });

  it("also exits when the row vanishes between two rounds", async () => {
    makeGoal();
    await runGoalLoop(
      GOAL,
      deps({
        decide: async () => {
          deleteGoal();
          return spawnOne();
        },
      }),
    );
    assert.equal(goalRow(), undefined);
  });
});

describe("charging a batch's cost", () => {
  const lot = (session: { status: SessionStatus; costUsd?: number | null }) =>
    runGoalLoop(GOAL, deps({ decide: scripted(spawnOne()), runTask: runTaskPosting([session]) }));

  it("counts a costless `failed` session at the billed sessions' average cost", async () => {
    makeGoal();
    billedSessions(1, 3);
    await lot({ status: SESSION_STATUS.failed, costUsd: null });

    assert.equal(goalRow()?.spentUsd, 2);
    assert.equal(goalEvents("task_done")[0]?.payload.costUsd, 2);
  });

  it("falls back to the default cost when no session has been billed yet", async () => {
    makeGoal();
    await lot({ status: SESSION_STATUS.failed, costUsd: null });
    assert.equal(goalRow()?.spentUsd, 0.25);
  });

  it("charges nothing for a costless `destroyed` session: only failure is presumed costly", async () => {
    makeGoal();
    billedSessions(1, 3);
    await lot({ status: SESSION_STATUS.destroyed, costUsd: null });
    assert.equal(goalRow()?.spentUsd, 0);
  });

  it("always prefers the real cost to the average", async () => {
    makeGoal();
    billedSessions(1, 3);
    await lot({ status: SESSION_STATUS.failed, costUsd: 0.5 });
    assert.equal(goalRow()?.spentUsd, 0.5);
  });
});

describe("a multi-task batch", () => {
  const troisSpawns: Decision = {
    action: "spawn",
    spawns: [
      { agentName: "qa", instruction: "review", priority: PRIORITY.low },
      { agentName: "dev", instruction: "produce", priority: PRIORITY.high },
      { agentName: "dev", instruction: "document", priority: PRIORITY.med },
    ],
    progressMade: true,
    reason: "three independent ones",
  };

  it("settles in one pass without mixing costs or notes between tasks", async () => {
    makeGoal();
    // One note per task, set at launch: what the `inArray` grouping could glue onto the wrong
    // `task_done`.
    const runTask: GoalLoopDeps["runTask"] = (() => {
      let n = 0;
      const poser = runTaskPosting([
        { status: SESSION_STATUS.destroyed, costUsd: 1 },
        { status: SESSION_STATUS.destroyed, costUsd: 2 },
        { status: SESSION_STATUS.destroyed, costUsd: 4 },
      ]);
      return async (taskId, opts) => {
        const rang = ++n;
        db.insert(schema.taskActivity)
          .values({
            id: `act-${rang}`,
            taskId,
            from: ACTIVITY_FROM.agent,
            body: `note ${rang}`,
            createdAt: now,
          })
          .run();
        return poser(taskId, opts);
      };
    })();

    await runGoalLoop(GOAL, deps({ decide: scripted(troisSpawns), runTask }));

    const tasks = goalTasks();
    assert.deepEqual(
      tasks.map((t) => t.priority),
      [PRIORITY.high, PRIORITY.med, PRIORITY.low],
      "the batch did not start in decreasing priority",
    );
    assert.deepEqual(
      tasks.map((t) => t.name),
      ["🎯 produce", "🎯 document", "🎯 review"],
    );
    assert.deepEqual(
      tasks.map((t) => t.assigneeAgentId),
      [AGENT_DEV, AGENT_DEV, AGENT_QA],
    );
    assert.equal(
      new Set(tasks.map((t) => t.boardOrder)).size,
      3,
      "two tasks of the batch share one rank",
    );

    const done = goalEvents("task_done");
    const parTache = new Map(done.map((e) => [e.payload.taskId as string, e.payload]));
    assert.equal(done.length, 3);
    tasks.forEach((t, i) => {
      // Rank 1 = highest priority, so cost 1 and note 1: each task gets its own back.
      assert.equal(parTache.get(t.id)?.costUsd, [1, 2, 4][i]);
      assert.equal(parTache.get(t.id)?.notes, `note ${i + 1}`);
    });
    assert.equal(goalRow()?.spentUsd, 7);
  });

  it("never launches more than three tasks, even if the model asks for more", async () => {
    makeGoal();
    const quatre: Decision = {
      ...troisSpawns,
      spawns: [
        ...(troisSpawns.spawns ?? []),
        { agentName: "dev", instruction: "one too many", priority: PRIORITY.high },
      ],
    };
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(quatre),
        runTask: runTaskPosting([{ status: SESSION_STATUS.destroyed, costUsd: 0 }]),
      }),
    );
    assert.equal(goalTasks().length, 3);
    assert.ok(!goalTasks().some((t) => t.name.includes("one too many")));
  });

  it("erases the row of a task whose launch failed: no orphan on the Board", async () => {
    makeGoal();
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(spawnOne()),
        runTask: async () => {
          throw new Error("runner at capacity");
        },
      }),
    );
    assert.equal(goalTasks().length, 0);
    assert.match(
      String(goalEvents("rail").find((e) => e.payload.spawnError)?.payload.spawnError),
      /runner at capacity/,
    );
  });
});

describe("waiting on a batch that never ends", () => {
  it("stops still-live sessions at timeout, and says so", async () => {
    makeGoal();
    const stopped: string[] = [];
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(spawnOne()),
        runTask: runTaskPosting([{ status: SESSION_STATUS.running }]),
        stopSession: async (id) => {
          stopped.push(id);
        },
      }),
    );
    assert.deepEqual(stopped, ["s-1"]);
    assert.ok(goalEvents("rail").some((e) => String(e.payload.note).includes("30 min timeout")));
  });
});

describe("the rails", () => {
  const railStatus = async (over: GoalOverrides) => {
    makeGoal(over);
    await runGoalLoop(GOAL, deps({ decide: scripted(spawnOne()) }));
    return goalRow()?.status;
  };

  it("cuts on budget", async () => {
    assert.equal(await railStatus({ budgetUsd: 1, spentUsd: 1 }), GOAL_STATUS.stoppedBudget);
  });

  it("cuts on duration", async () => {
    assert.equal(
      await railStatus({ maxDurationMs: 1, startedAt: new Date(Date.now() - 60_000) }),
      GOAL_STATUS.stoppedTime,
    );
  });

  it("cuts on a stall", async () => {
    assert.equal(
      await railStatus({ noProgressStreak: 3, maxNoProgress: 3 }),
      GOAL_STATUS.stoppedStuck,
    );
  });

  it("cuts at the iteration cap without consulting the model", async () => {
    makeGoal({ iterations: 60 });
    let consulte = 0;
    await runGoalLoop(
      GOAL,
      deps({
        decide: async () => {
          consulte += 1;
          return spawnOne();
        },
      }),
    );
    assert.equal(consulte, 0, "an orchestrator call was wasted at the cap");
    assert.equal(goalRow()?.status, GOAL_STATUS.stoppedStuck);
    assert.match(String(goalEvents("status").at(-1)?.payload.reason), /iteration cap \(60\)/);
  });

  it("fails when the allowed agent pool is empty", async () => {
    makeGoal({ allowedAgentIds: JSON.stringify(["a-unknown"]) });
    await runGoalLoop(GOAL, deps({ decide: scripted(spawnOne()) }));
    assert.equal(goalRow()?.status, GOAL_STATUS.failed);
  });

  it("does not run at all on a demo project", async () => {
    makeGoal({ projectId: DEMO }, "g-demo");
    await runGoalLoop(
      "g-demo",
      deps({
        decide: async () => {
          throw new Error("never called");
        },
      }),
    );
    assert.equal(goalRow("g-demo")?.status, GOAL_STATUS.active);
    assert.equal(goalEvents(undefined, "g-demo").length, 0);
  });
});

describe("a `complete` decision", () => {
  const complete = (dodDone?: string[]): Decision => ({
    action: "complete",
    dodDone,
    progressMade: true,
    reason: "all done",
  });

  it("finishes the goal when every criterion is really ticked", async () => {
    makeGoal();
    await runGoalLoop(GOAL, deps({ decide: scripted(complete(["d1"])) }));
    assert.equal(goalRow()?.status, GOAL_STATUS.completed);
    assert.ok(dodOf().every((d) => d.done));
  });

  it("does not hold if the DoD is incomplete, and counts as a round without progress", async () => {
    makeGoal({ maxNoProgress: 1 });
    await runGoalLoop(GOAL, deps({ decide: scripted(complete(), complete()) }));
    assert.equal(
      goalRow()?.status,
      GOAL_STATUS.stoppedStuck,
      "an unproven complete finished the goal",
    );
    assert.ok(
      goalEvents("rail").some((e) =>
        String(e.payload.note).includes("complete claimed but DoD incomplete"),
      ),
    );
  });
});

describe("a `spawn` decision without an instruction", () => {
  it("counts as a round without progress rather than playing empty", async () => {
    makeGoal({ maxNoProgress: 1 });
    const vide: Decision = {
      action: "spawn",
      agentName: "dev",
      instruction: "   ",
      progressMade: true,
      reason: "empty",
    };
    await runGoalLoop(GOAL, deps({ decide: scripted(vide, vide) }));
    assert.equal(goalTasks().length, 0);
    assert.ok(
      goalEvents("rail").some((e) =>
        String(e.payload.note).includes("spawn without an instruction"),
      ),
    );
    assert.equal(goalRow()?.status, GOAL_STATUS.stoppedStuck);
  });
});

describe("an unreachable orchestrator", () => {
  it("retries three times then pauses, never `failed`: the failure is recoverable", async () => {
    makeGoal();
    let appels = 0;
    const attentes: number[] = [];
    await runGoalLoop(
      GOAL,
      deps({
        decide: async () => {
          appels += 1;
          throw new Error("rate limited");
        },
        sleep: async (ms) => {
          attentes.push(ms);
        },
      }),
    );
    assert.equal(appels, 3);
    assert.deepEqual(attentes, [20_000, 40_000, 60_000]);
    assert.equal(goalRow()?.status, GOAL_STATUS.paused);
    assert.match(String(goalEvents("status").at(-1)?.payload.reason), /orchestrator unreachable/);
  });

  it("resumes after a transient failure", async () => {
    makeGoal();
    let appels = 0;
    await runGoalLoop(
      GOAL,
      deps({
        decide: async () => {
          appels += 1;
          if (appels === 1) throw new Error("blip");
          return { action: "stop", progressMade: false, reason: "enough" };
        },
      }),
    );
    assert.equal(goalRow()?.status, GOAL_STATUS.stoppedStuck);
  });
});

describe("the loop's safety net", () => {
  it("pauses on an unexpected error, never bringing the process down", async () => {
    makeGoal();
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(spawnOne()),
        runTask: runTaskPosting([{ status: SESSION_STATUS.destroyed, costUsd: 0 }]),
        // The batch poll passes (4 s), the end-of-round breather (500 ms) breaks.
        sleep: async (ms) => {
          if (ms === 500) throw new Error("unexpected failure");
        },
      }),
    );
    assert.equal(goalRow()?.status, GOAL_STATUS.paused);
    assert.match(String(goalEvents("rail").at(-1)?.payload.loopError), /unexpected failure/);
  });
});

describe("the mock shortcut", () => {
  it("only ticks a criterion for a task that really finished", async () => {
    makeGoal({
      dod: JSON.stringify([
        { id: "d1", text: "one", done: false },
        { id: "d2", text: "two", done: false },
      ]),
    });
    const runTask = runTaskPosting([{ status: SESSION_STATUS.destroyed, costUsd: 0 }]);
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(spawnOne()),
        runTask: async (taskId, opts) => {
          db.update(schema.tasks)
            .set({ status: TASK_STATUS.done })
            .where(eq(schema.tasks.id, taskId))
            .run();
          return runTask(taskId, opts);
        },
      }),
    );
    assert.deepEqual(
      dodOf().map((d) => d.done),
      [true, false],
    );
  });

  it("ticks nothing for a task sent back to review", async () => {
    makeGoal();
    const runTask = runTaskPosting([{ status: SESSION_STATUS.destroyed, costUsd: 0 }]);
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(spawnOne()),
        runTask: async (taskId, opts) => {
          db.update(schema.tasks)
            .set({ status: TASK_STATUS.review })
            .where(eq(schema.tasks.id, taskId))
            .run();
          return runTask(taskId, opts);
        },
      }),
    );
    assert.deepEqual(
      dodOf().map((d) => d.done),
      [false],
    );
  });
});

describe("the DoD and its approval", () => {
  it("generates a deterministic DoD and plan in mock", async () => {
    makeGoal({ status: GOAL_STATUS.draft, dod: "[]", plan: "[]" });
    const { dod, plan } = await generateDod(GOAL);
    assert.equal(dod.length, 2);
    assert.equal(plan.length, 2);
    assert.deepEqual(
      dod.map((d) => d.done),
      [false, false],
    );
    assert.equal(plan[0]?.agentName, "dev");
    assert.equal(goalEvents("dod")[0]?.payload.generated, 2);
  });

  it("refuses an unknown goal", async () => {
    await assert.rejects(() => generateDod("g-unknown"), /goal not found/);
  });

  it("makes the goal active and starts the loop", async () => {
    makeGoal({ status: GOAL_STATUS.draft });
    approveDod(GOAL, [{ id: "", text: "the artifact exists" }], deps());
    await new Promise(setImmediate);
    assert.equal(goalRow()?.mock, true, "without a credential the goal must run in mock");
    assert.equal(dodOf()[0]?.id, "d1", "an empty id is renumbered");
    assert.equal(
      goalRow()?.status,
      GOAL_STATUS.stoppedStuck,
      "the loop did not start after approval",
    );
  });

  // Refusals are returned, not thrown (06/09), each with its status. The message is checked to the
  // character: the screen shows it, and nothing else protects it.
  it("refuses an empty DoD and a goal no longer in draft", () => {
    makeGoal({ status: GOAL_STATUS.draft });
    assert.deepEqual(approveDod(GOAL, [], deps()), {
      ok: false,
      status: 400,
      error: "DoD cannot be empty",
    });
    makeGoal({ status: GOAL_STATUS.active }, "g-active");
    assert.deepEqual(approveDod("g-active", [{ id: "d1", text: "x" }], deps()), {
      ok: false,
      status: 409,
      error: "goal is active",
    });
    assert.deepEqual(approveDod("g-unknown", [{ id: "d1", text: "x" }], deps()), {
      ok: false,
      status: 404,
      error: "goal not found",
    });
  });
});

describe("the operator-driven lifecycle", () => {
  it("pauses, then resumes resetting the stall counter to zero", async () => {
    makeGoal({ noProgressStreak: 2 });
    pauseGoal(GOAL);
    assert.equal(goalRow()?.status, GOAL_STATUS.paused);
    assert.deepEqual(pauseGoal(GOAL), { ok: false, status: 409, error: "goal is paused" });

    // Read before the first round: resuming resets the counter at once, and the next round raises
    // it again. What is protected is the reset, not what becomes of it.
    resumeGoal(GOAL, deps());
    assert.equal(goalRow()?.noProgressStreak, 0);
    await new Promise(setImmediate);
    assert.equal(goalRow()?.status, GOAL_STATUS.stoppedStuck);
    assert.deepEqual(resumeGoal(GOAL, deps()), {
      ok: false,
      status: 409,
      error: `goal is ${GOAL_STATUS.stoppedStuck}`,
    });
    assert.deepEqual(pauseGoal("g-unknown"), { ok: false, status: 404, error: "goal not found" });
    assert.deepEqual(resumeGoal("g-unknown", deps()), {
      ok: false,
      status: 404,
      error: "goal not found",
    });
  });

  it("the kill switch writes `cancelled` and kills live sessions, never those pushing", () => {
    makeGoal();
    db.insert(schema.tasks)
      .values({
        id: "t-1",
        projectId: PROJECT,
        name: "t",
        status: TASK_STATUS.doing,
        goalId: GOAL,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const poser = runTaskPosting([
      { status: SESSION_STATUS.running },
      { status: SESSION_STATUS.committing },
      { status: SESSION_STATUS.blocked },
    ]);
    void poser("t-1", { mock: true });
    void poser("t-1", { mock: true });
    void poser("t-1", { mock: true });

    const stopped: string[] = [];
    killGoal(
      GOAL,
      deps({
        stopSession: async (id) => {
          stopped.push(id);
        },
      }),
    );

    assert.equal(goalRow()?.status, GOAL_STATUS.cancelled);
    assert.deepEqual(stopped.sort(), ["s-1", "s-3"], "`committing` must never be interrupted");
    assert.deepEqual(killGoal("g-unknown", deps()), {
      ok: false,
      status: 404,
      error: "goal not found",
    });
  });

  it("a kill on a goal without tasks looks for no session", () => {
    makeGoal();
    killGoal(
      GOAL,
      deps({
        stopSession: async () => {
          throw new Error("never");
        },
      }),
    );
    assert.equal(goalRow()?.status, GOAL_STATUS.cancelled);
  });

  it("boot recovery restarts active goals and leaves the demo frozen", async () => {
    makeGoal();
    makeGoal({ projectId: DEMO }, "g-demo");
    recoverGoals(deps());
    await new Promise(setImmediate);
    assert.equal(goalRow()?.status, GOAL_STATUS.stoppedStuck);
    assert.equal(goalRow("g-demo")?.status, GOAL_STATUS.active);
  });
});

describe("reading a goal", () => {
  it("decodes the three JSON columns, the same shape everywhere", () => {
    makeGoal({ allowedAgentIds: JSON.stringify([AGENT_DEV]) });
    const row = goalRow();
    assert.ok(row);
    const serialise = serializeGoal(row);
    assert.deepEqual(serialise.allowedAgentIds, [AGENT_DEV]);
    assert.equal(serialise.dod[0]?.text, "the artifact exists");
    assert.equal(serialise.plan[0]?.step, "produce");

    assert.equal(listGoals(PROJECT).length, 1);
    assert.equal(listGoals().length, 1);
    assert.equal(listGoals("p-empty").length, 0);
  });

  it("the detail carries the goal's log and tasks, serialised as elsewhere", async () => {
    makeGoal();
    await runGoalLoop(
      GOAL,
      deps({
        decide: scripted(spawnOne()),
        runTask: runTaskPosting([{ status: SESSION_STATUS.destroyed, costUsd: 0 }]),
      }),
    );
    const detail = goalDetail(GOAL);
    assert.ok(detail);
    assert.equal(detail.tasks.length, 1);
    assert.ok(detail.events.some((e) => e.type === "task_spawned"));
    assert.ok(detail.events.every((e) => typeof e.ts === "number"));
    assert.equal(goalDetail("g-unknown"), null);
  });
});
