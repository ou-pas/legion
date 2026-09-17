// Deleting a goal (spec of 02/09, amended 03/09). Style neighbour: `projects/purge.test.ts`, which
// protects the same promise one level down ("a deleted blocker stops blocking").
//
// Nine properties:
//  1. an unknown id destroys nothing (404);
//  2. a `committing` session refuses deletion by name and the goal stays intact: the guard that
//     prevents erasing the row of a container pushing its branch;
//  3. a `draft` goal (the common case: never approved, so zero tasks) goes in one gesture;
//  4. an `active` goal is refused for now, with the gesture to make, and its row is proven
//     unchanged: slice 1's cut, not a "forbidden";
//  5. the cascade leaves no orphan row in the eight tables involved;
//  6. a task outside the goal, unblocked by the deletion, is announced before the click;
//  7. the `/artifacts/<goalId>` folder no longer exists on disk (the one act no backup recovers);
//  8. the deletion leaves a trace in `control_events`;
//  9. the inbox entry of a session asleep on a goal task is closed, without waking (Q1).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { SessionStatus } from "../sessions/session-terminal.js";

const dir = mkdtempSync(join(tmpdir(), "legion-goal-delete-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerGoalRoutes } = await import("./routes.js");
const { goalDeletionPreview } = await import("./goal-delete.js");
const { addBlocker, blockersOf } = await import("../tasks/blockers.js");
const { SESSION_STATUS } = await import("../sessions/session-terminal.js");
const { TASK_STATUS } = await import("../tasks/lifecycle.js");
const { GOAL_STATUS } = await import("./goal-status.js");
const { RUNNER_KIND } = await import("../shared/enums.js");
const { ACTIVITY_FROM } = await import("../tasks/activity-enums.js");

const app = new Hono();
registerGoalRoutes(app);

const PROJECT = "p-goal";
const SLUG = "pgoal";
const AGENT = "a-goal";
const RUNNER = "r-goal";
const GOAL = "g1";

const now = new Date();

function reset(): void {
  db.delete(schema.inboxMessages).run();
  db.delete(schema.sessionSteers).run();
  db.delete(schema.sessionEvents).run();
  db.delete(schema.sessions).run();
  db.delete(schema.taskBlockers).run();
  db.delete(schema.taskActivity).run();
  db.delete(schema.reviewComments).run();
  db.delete(schema.tasks).run();
  db.delete(schema.goalEvents).run();
  db.delete(schema.goals).run();
  db.delete(schema.controlEvents).run();
  db.delete(schema.runners).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  db.insert(schema.projects).values({ id: PROJECT, name: "P", slug: SLUG, createdAt: now }).run();
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
  rmSync(join(dir, "fs", SLUG), { recursive: true, force: true });
}

type GoalStatus = (typeof schema.goals.$inferInsert)["status"];

function makeGoal(status: GoalStatus = GOAL_STATUS.draft, id = GOAL): void {
  db.insert(schema.goals)
    .values({
      id,
      projectId: PROJECT,
      name: `goal ${id}`,
      request: "do the thing",
      status,
      createdAt: now,
    })
    .run();
}

function makeTask(id: string, over: Partial<typeof schema.tasks.$inferInsert> = {}): void {
  db.insert(schema.tasks)
    .values({
      id,
      projectId: PROJECT,
      name: `task ${id}`,
      status: TASK_STATUS.todo,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .run();
}

function makeSession(
  id: string,
  taskId: string,
  status: SessionStatus = SESSION_STATUS.destroyed,
): void {
  db.insert(schema.sessions)
    .values({
      id,
      taskId,
      agentId: AGENT,
      runnerId: RUNNER,
      status,
      model: "sonnet",
      callbackToken: `tok-${id}`,
      startedAt: now,
    })
    .run();
}

/** The folder shared by all the goal's tasks, as the runtime mounts it. */
function makeArtifacts(goalId = GOAL): string {
  const target = join(dir, "fs", SLUG, "artifacts", goalId);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "spec.md"), "# artifact");
  return target;
}

const goalRow = (id = GOAL) => db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
const del = (id = GOAL) => app.request(`/api/goals/${id}`, { method: "DELETE" });
const footprint = (id = GOAL) => app.request(`/api/goals/${id}/footprint`);

type DeleteBody = {
  ok?: boolean;
  error?: string;
  deleted?: string;
  footprint?: { tasks: number; sessions: number; artifactsDir: boolean };
  unblocked?: { id: string; name: string }[];
  closedWaits?: string[];
  live?: { id: string; status: string; taskName: string }[];
};

describe("DELETE /api/goals/:id: refusals", () => {
  beforeEach(reset);

  it("an unknown id: 404, and nothing is destroyed", async () => {
    makeGoal(GOAL_STATUS.draft);
    const res = await del("ghost");
    assert.equal(res.status, 404);
    assert.match(((await res.json()) as DeleteBody).error!, /not found/);
    assert.ok(goalRow(), "the existing goal did not move");
  });

  it("a committing session: a named refusal, and the goal row provably unchanged", async () => {
    makeGoal(GOAL_STATUS.failed);
    makeTask("t1", { goalId: GOAL, name: "push the branch" });
    makeSession("s1", "t1", "committing");

    const res = await del();
    assert.equal(res.status, 409);
    const body = (await res.json()) as DeleteBody;
    assert.match(body.error!, /is still pushing its branch/);
    assert.match(body.error!, /pushing its branch/, "the offending task is named");
    assert.equal(body.live?.[0]?.status, "committing");
    assert.equal(goalRow()?.status, GOAL_STATUS.failed, "the goal is there, with its status");
    assert.ok(
      db.select().from(schema.tasks).where(eq(schema.tasks.id, "t1")).get(),
      "its task too",
    );
  });

  it("an active goal: a guiding refusal (not yet), row unchanged", async () => {
    makeGoal(GOAL_STATUS.active);
    const res = await del();
    assert.equal(res.status, 409);
    const { error } = (await res.json()) as DeleteBody;
    assert.match(error!, /kill switch/, "the refusal says what to do");
    assert.match(error!, /NOT SHIPPED YET/, "and that this is a slicing cut, not a ban");
    assert.equal(goalRow()?.status, GOAL_STATUS.active);
  });

  it("a paused goal too: same refusal", async () => {
    makeGoal(GOAL_STATUS.paused);
    assert.equal((await del()).status, 409);
    assert.ok(goalRow());
  });

  it("a failed goal without a committing session is deleted: that is the refusal's distinction", async () => {
    makeGoal(GOAL_STATUS.failed);
    makeTask("t1", { goalId: GOAL });
    makeSession("s1", "t1", "destroyed");
    assert.equal((await del()).status, 200);
    assert.equal(goalRow(), undefined);
  });
});

describe("DELETE /api/goals/:id: deletion", () => {
  beforeEach(reset);

  it("a draft goal with no task: deleted, zero footprint, and GET returns 404 afterwards", async () => {
    makeGoal(GOAL_STATUS.draft);
    const res = await del();
    assert.equal(res.status, 200);
    const body = (await res.json()) as DeleteBody;
    assert.equal(body.deleted, "goal g1");
    assert.deepEqual(body.footprint, {
      tasks: 0,
      sessions: 0,
      sessionEvents: 0,
      inbox: 0,
      reviewComments: 0,
      activity: 0,
      goalEvents: 0,
      artifactsDir: false,
    });
    assert.equal((await app.request(`/api/goals/${GOAL}`)).status, 404);
    assert.equal((await footprint()).status, 404);
  });

  it("the cascade leaves no orphan row", async () => {
    makeGoal(GOAL_STATUS.completed);
    makeTask("t1", { goalId: GOAL });
    makeTask("t2", { goalId: GOAL });
    makeSession("s1", "t1");
    db.insert(schema.sessionEvents)
      .values({ sessionId: "s1", type: "text", payload: "{}", createdAt: now })
      .run();
    db.insert(schema.sessionSteers)
      .values({ id: "st1", sessionId: "s1", text: "go faster", createdAt: now })
      .run();
    db.insert(schema.inboxMessages)
      .values({
        id: "i1",
        sessionId: "s1",
        taskId: "t1",
        agentId: AGENT,
        kind: "text",
        body: "?",
        createdAt: now,
      })
      .run();
    db.insert(schema.reviewComments)
      .values({
        id: "rc1",
        taskId: "t1",
        repoName: "web",
        filePath: "a.ts",
        line: 3,
        body: "hm",
        createdAt: now,
      })
      .run();
    db.insert(schema.taskActivity)
      .values({
        id: "act1",
        taskId: "t1",
        from: ACTIVITY_FROM.system,
        body: "note",
        createdAt: now,
      })
      .run();
    db.insert(schema.goalEvents)
      .values({ goalId: GOAL, type: "status", payload: "{}", createdAt: now })
      .run();

    const body = (await (await del()).json()) as DeleteBody;
    assert.equal(body.footprint?.tasks, 2);
    assert.equal(body.footprint?.sessions, 1);

    assert.equal(db.select().from(schema.goals).all().length, 0);
    assert.equal(db.select().from(schema.goalEvents).all().length, 0);
    assert.equal(db.select().from(schema.tasks).all().length, 0);
    assert.equal(db.select().from(schema.sessions).all().length, 0);
    assert.equal(db.select().from(schema.sessionEvents).all().length, 0);
    assert.equal(db.select().from(schema.sessionSteers).all().length, 0);
    assert.equal(db.select().from(schema.inboxMessages).all().length, 0);
    assert.equal(db.select().from(schema.reviewComments).all().length, 0);
    assert.equal(db.select().from(schema.taskActivity).all().length, 0);
  });

  it("the goal's artifacts folder no longer exists on disk", async () => {
    makeGoal(GOAL_STATUS.stoppedStuck);
    makeTask("t1", { goalId: GOAL });
    const target = makeArtifacts();
    assert.ok(existsSync(target));

    const preview = goalDeletionPreview(GOAL);
    assert.equal(
      preview?.footprint.artifactsDir,
      true,
      "announced before: there is a folder to erase",
    );

    const body = (await (await del()).json()) as DeleteBody;
    assert.equal(body.footprint?.artifactsDir, true);
    assert.equal(existsSync(target), false, "erased");
  });

  it("the deletion leaves a trace in the control plane log", async () => {
    makeGoal(GOAL_STATUS.failed);
    await del();
    const traces = db
      .select()
      .from(schema.controlEvents)
      .all()
      .filter((e) => e.source === "goals");
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.level, "info");
    assert.match(traces[0]!.message, /deleted/);
    assert.match(traces[0]!.payload ?? "", new RegExp(GOAL));
  });
});

describe("DELETE /api/goals/:id: announced side effects", () => {
  beforeEach(reset);

  it("a task outside the goal, unblocked by the deletion, is announced before and unblocked after", async () => {
    makeGoal(GOAL_STATUS.completed);
    makeTask("blocker", { goalId: GOAL });
    makeTask("next", { name: "next step" }); // outside the goal
    addBlocker("next", "blocker");

    const preview = (await (await footprint()).json()) as {
      unblocks: { id: string; name: string }[];
    };
    assert.deepEqual(preview.unblocks, [{ id: "next", name: "next step" }]);

    const body = (await (await del()).json()) as DeleteBody;
    assert.deepEqual(body.unblocked, [{ id: "next", name: "next step" }]);
    assert.deepEqual(blockersOf("next"), [], "nothing holds it any more");
    assert.ok(
      db.select().from(schema.tasks).where(eq(schema.tasks.id, "next")).get(),
      "the task itself stays",
    );
  });

  it("a task an outside blocker still holds is not announced as unblocked", async () => {
    makeGoal(GOAL_STATUS.completed);
    makeTask("blocker", { goalId: GOAL });
    makeTask("elsewhere");
    makeTask("next");
    addBlocker("next", "blocker");
    addBlocker("next", "elsewhere");

    const preview = goalDeletionPreview(GOAL);
    assert.deepEqual(preview?.unblocks, [], "a link from elsewhere holds it");

    await del();
    assert.deepEqual(blockersOf("next"), ["elsewhere"]);
  });

  it("the inbox entry of a session asleep on a goal task is closed, without waking (Q1)", async () => {
    makeGoal(GOAL_STATUS.completed);
    makeTask("awaited", { goalId: GOAL });
    makeTask("sleeper");
    makeSession("s-sleeper", "sleeper", SESSION_STATUS.waiting);
    db.insert(schema.inboxMessages)
      .values({
        id: "i-wait",
        sessionId: "s-sleeper",
        taskId: "sleeper",
        agentId: AGENT,
        kind: "text",
        body: "waiting",
        waitForTaskId: "awaited",
        createdAt: now,
      })
      .run();

    const body = (await (await del()).json()) as DeleteBody;
    assert.deepEqual(body.closedWaits, ["i-wait"]);
    const entry = db
      .select()
      .from(schema.inboxMessages)
      .where(eq(schema.inboxMessages.id, "i-wait"))
      .get();
    assert.equal(entry?.status, "closed", "nothing points at a vanished task any more");
    assert.equal(entry?.answerText, null, "closed, not answered: no wake-up");
    const session = db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, "s-sleeper"))
      .get();
    assert.equal(
      session?.status,
      SESSION_STATUS.waiting,
      "the session still sleeps, a named consequence of D6",
    );
    const notes = db
      .select()
      .from(schema.taskActivity)
      .where(eq(schema.taskActivity.taskId, "sleeper"))
      .all();
    assert.match(
      notes[0]?.body ?? "",
      /deleted along with its goal/,
      "and the waiting task says so",
    );
  });
});
