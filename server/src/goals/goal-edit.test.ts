// Editing a goal, which used to be immutable from creation. Four promises:
//  1. The status rule. The brief (`name`, `request`, `allowedAgentIds`) freezes at approval; the
//     rails (`budgetUsd`, `maxHours`, `maxNoProgress`) follow the goal while it runs. Each refusal
//     is checked by its message and by the row proven unchanged: a bare 409 would leave the
//     operator guessing which case they hit.
//  2. Validation. A zero rail, a fractional threshold, an agent from another project: each refused
//     naming the field. Without the agent guard a foreign id emptied the pool and the loop stopped
//     much later on "no allowed agents".
//  3. Regeneration. Changing the request redoes DoD and plan in the same gesture; not changing it
//     leaves them alone; and a failing generation does not lose the edit (already written, DoD
//     empty, `POST /regenerate` recovers). Same tolerance as creation (201 + `warning`).
//  4. Cancelling is not a failure. The kill switch writes `cancelled`, not `failed`, and a
//     `cancelled` goal stays deletable: deletion must read it as a stopped goal.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "legion-goal-edit-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_DATA = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { registerGoalRoutes } = await import("./routes.js");
const { editGoal, regenerateGoalDod } = await import("./goal-edit.js");
const { GOAL_STATUS } = await import("./goal-status.js");
type GoalEditDeps = import("./goal-edit.js").GoalEditDeps;

const app = new Hono();
registerGoalRoutes(app);

const PROJECT = "p-edit";
const OTHER_PROJECT = "p-other";
const AGENT = "a-edit";
const STRANGER = "a-stranger";
const GOAL = "g1";

const now = new Date();

function reset(): void {
  db.delete(schema.goalEvents).run();
  db.delete(schema.tasks).run();
  db.delete(schema.goals).run();
  db.delete(schema.agents).run();
  db.delete(schema.projects).run();
  for (const [id, slug] of [
    [PROJECT, "pedit"],
    [OTHER_PROJECT, "pother"],
  ])
    db.insert(schema.projects).values({ id: id!, name: id!, slug: slug!, createdAt: now }).run();
  db.insert(schema.agents)
    .values({
      id: AGENT,
      projectId: PROJECT,
      name: "dev",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
  db.insert(schema.agents)
    .values({
      id: STRANGER,
      projectId: OTHER_PROJECT,
      name: "dev",
      rolePrompt: "r",
      inboxAccess: true,
      createdAt: now,
    })
    .run();
}

type GoalStatus = NonNullable<(typeof schema.goals.$inferInsert)["status"]>;

/** `mock: true` by default: `generateDod` has a deterministic offline path for a goal whose project
 *  has no credential, which makes regeneration testable for real. */
function makeGoal(
  status: GoalStatus = GOAL_STATUS.draft,
  over: Partial<typeof schema.goals.$inferInsert> = {},
): void {
  db.insert(schema.goals)
    .values({
      id: GOAL,
      projectId: PROJECT,
      name: "initial goal",
      request: "do the thing",
      status,
      mock: true,
      createdAt: now,
      dod: JSON.stringify([{ id: "d1", text: "previous criterion", done: false }]),
      plan: JSON.stringify([{ step: "previous step", agentName: "dev", why: "because" }]),
      ...over,
    })
    .run();
}

const goalRow = (id = GOAL) => db.select().from(schema.goals).where(eq(schema.goals.id, id)).get();
const events = (type: string) =>
  db
    .select()
    .from(schema.goalEvents)
    .where(eq(schema.goalEvents.goalId, GOAL))
    .all()
    .filter((e) => e.type === type);

type EditBody = {
  ok?: boolean;
  error?: string;
  changed?: string[];
  warning?: string;
  goal?: {
    name: string;
    request: string;
    budgetUsd: number | null;
    maxDurationMs: number | null;
    maxNoProgress: number;
    allowedAgentIds: string[];
  };
  dod?: { id: string; text: string }[];
  plan?: { step: string }[];
};

const edit = (body: unknown, id = GOAL) =>
  app.request(`/api/goals/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const read = async (res: Response) => (await res.json()) as EditBody;

describe("PATCH /api/goals/:id: the status rule", () => {
  beforeEach(reset);

  it("an unknown id: 404", async () => {
    makeGoal();
    const res = await edit({ name: "other" }, "ghost");
    assert.equal(res.status, 404);
    assert.match((await read(res)).error!, /not found/);
  });

  // The refusal now comes from the schema (06/09) and names the refused keys rather than listing
  // the accepted ones, before the route opens the database. The point is unchanged: `status` and
  // `spentUsd` are not editable, and the row does not move.
  it("a body with no editable field: a 400 naming the refused keys", async () => {
    makeGoal();
    const res = await edit({ spentUsd: 0, status: GOAL_STATUS.completed });
    assert.equal(res.status, 400);
    const { error } = await read(res);
    assert.match(error!, /spentUsd/, "the refusal says what it rejected");
    assert.match(error!, /status/);
    assert.equal(goalRow()?.status, GOAL_STATUS.draft, "and above all the status did not move");
  });

  it("the brief freezes at approval: 409 on an active goal, row unchanged", async () => {
    makeGoal(GOAL_STATUS.active);
    for (const patch of [
      { name: "renamed" },
      { request: "something else" },
      { allowedAgentIds: [AGENT] },
    ]) {
      const res = await edit(patch);
      assert.equal(res.status, 409, `refusal expected for ${Object.keys(patch)[0]}`);
      const { error } = await read(res);
      assert.match(error!, /already gone into the loop/, "the refusal says why");
      assert.match(error!, /rails/, "and what stays editable");
    }
    assert.equal(goalRow()?.name, "initial goal");
    assert.equal(goalRow()?.request, "do the thing");
  });

  it("… and on a paused goal too: the loop resumes with the request it received", async () => {
    makeGoal(GOAL_STATUS.paused);
    assert.equal((await edit({ request: "something else" })).status, 409);
    assert.equal(goalRow()?.request, "do the thing");
  });

  it("rails follow a running goal: budget raised on an active goal", async () => {
    makeGoal(GOAL_STATUS.active, { budgetUsd: 5, spentUsd: 4.8 });
    const res = await edit({ budgetUsd: 20 });
    assert.equal(res.status, 200);
    assert.deepEqual((await read(res)).changed, ["budgetUsd"]);
    assert.equal(goalRow()?.budgetUsd, 20);
    assert.equal(goalRow()?.status, GOAL_STATUS.active, "raising a rail does not touch the status");
  });

  it("… and on a paused goal: the gesture that comes before resuming", async () => {
    makeGoal(GOAL_STATUS.paused, { maxNoProgress: 3 });
    assert.equal((await edit({ maxNoProgress: 6 })).status, 200);
    assert.equal(goalRow()?.maxNoProgress, 6);
  });

  it("a finished goal no longer moves, rails included: raising its budget does not restart it", async () => {
    for (const status of [
      GOAL_STATUS.completed,
      GOAL_STATUS.stoppedBudget,
      GOAL_STATUS.failed,
      GOAL_STATUS.cancelled,
    ] as GoalStatus[]) {
      reset();
      makeGoal(status, { budgetUsd: 5 });
      const res = await edit({ budgetUsd: 50 });
      assert.equal(res.status, 409, `refusal expected for ${status}`);
      const { error } = await read(res);
      assert.match(error!, /is over/);
      assert.match(error!, /paused/, "the refusal names the only state that resumes");
      assert.equal(goalRow()?.budgetUsd, 5);
    }
  });
});

describe("PATCH /api/goals/:id: input validation", () => {
  beforeEach(() => {
    reset();
    makeGoal(GOAL_STATUS.draft);
  });

  const refuses = async (patch: unknown, pattern: RegExp) => {
    const res = await edit(patch);
    assert.equal(res.status, 400, `400 expected for ${JSON.stringify(patch)}`);
    assert.match((await read(res)).error!, pattern);
  };

  // A wrong type is now refused one level up (06/09): `goals/schemas.ts` judges the body's shape
  // before the route calls `editGoal`, so `name: 42` returns the faulty key's path rather than
  // `goal-edit.ts`'s message. The domain's value rules (empty, non-positive, agent from another
  // project) are still its own; the unchanged cases check that.
  it("an empty (or blank) name is refused", async () => {
    await refuses({ name: "   " }, /name cannot be empty/);
    await refuses({ name: 42 }, /name — /);
  });

  it("an empty request is refused: a goal without a request has nothing to orchestrate", async () => {
    await refuses({ request: "" }, /request cannot be empty/);
  });

  it("a budget that is not strictly positive, not finite, or not a number", async () => {
    await refuses({ budgetUsd: -1 }, /budgetUsd must be strictly positive/);
    await refuses({ budgetUsd: 0 }, /strictly positive/);
    await refuses({ budgetUsd: "12" }, /budgetUsd — /);
    // NaN/Infinity do not survive JSON (`JSON.stringify(NaN)` gives `null`, i.e. "no cap"): the
    // guard is proven on the domain, where the value still exists.
    const nan = await editGoal(GOAL, { budgetUsd: Number.NaN });
    assert.equal(nan.ok, false);
    if (!nan.ok) assert.match(nan.error, /budgetUsd must be a number/);
    const infinite = await editGoal(GOAL, { maxHours: Number.POSITIVE_INFINITY });
    assert.equal(infinite.ok, false);
  });

  it("a non-positive duration", async () => {
    await refuses({ maxHours: 0 }, /maxHours must be strictly positive/);
  });

  it("a no-progress threshold that is fractional, zero, or cleared", async () => {
    await refuses({ maxNoProgress: 2.5 }, /maxNoProgress — /);
    await refuses({ maxNoProgress: 0 }, /strictly positive/);
    await refuses({ maxNoProgress: null }, /maxNoProgress — /);
  });

  it("an agent from another project is named in the refusal, not discovered later by the loop", async () => {
    await refuses(
      { allowedAgentIds: [AGENT, STRANGER] },
      new RegExp(`“${STRANGER}” unknown in this project`),
    );
    await refuses({ allowedAgentIds: "a-edit" }, /allowedAgentIds — /);
    assert.deepEqual(JSON.parse(goalRow()!.allowedAgentIds), [], "nothing was written");
  });

  it("`null` on a rail is a value (no cap), not an absence", async () => {
    db.update(schema.goals)
      .set({ budgetUsd: 12, maxDurationMs: 3_600_000 })
      .where(eq(schema.goals.id, GOAL))
      .run();
    assert.equal((await edit({ budgetUsd: null, maxHours: null })).status, 200);
    assert.equal(goalRow()?.budgetUsd, null);
    assert.equal(goalRow()?.maxDurationMs, null);
  });
});

describe("PATCH /api/goals/:id: what gets written", () => {
  beforeEach(reset);

  it("name, agent pool, and hours converted to milliseconds", async () => {
    makeGoal(GOAL_STATUS.draft);
    const res = await edit({ name: "  renamed goal  ", allowedAgentIds: [AGENT], maxHours: 2.5 });
    assert.equal(res.status, 200);
    const body = await read(res);
    assert.equal(body.goal?.name, "renamed goal", "the name is trimmed");
    assert.deepEqual(
      body.goal?.allowedAgentIds,
      [AGENT],
      "the response returns the goal deserialised",
    );
    assert.equal(goalRow()?.maxDurationMs, 9_000_000, "2.5 h → 9,000,000 ms, as at creation");
    assert.deepEqual(body.changed?.sort(), ["allowedAgentIds", "maxHours", "name"]);
  });

  it("an identical rewrite changes nothing and logs nothing", async () => {
    makeGoal(GOAL_STATUS.draft);
    const res = await edit({ name: "initial goal", request: "do the thing" });
    assert.equal(res.status, 200);
    assert.deepEqual((await read(res)).changed, [], "no field moved");
    assert.equal(events("edit").length, 0);
    assert.equal(JSON.parse(goalRow()!.dod).length, 1, "and the previous DoD is intact");
  });

  it("the edit goes into the goal's log, with the rails as they now are", async () => {
    makeGoal(GOAL_STATUS.active, { budgetUsd: 5 });
    await edit({ budgetUsd: 30 });
    const [entry] = events("edit");
    assert.ok(entry, "an `edit` entry in goal_events");
    const payload = JSON.parse(entry!.payload) as { changed: string[]; budgetUsd: number };
    assert.deepEqual(payload.changed, ["budgetUsd"]);
    assert.equal(payload.budgetUsd, 30);
  });
});

describe("PATCH /api/goals/:id: DoD regeneration", () => {
  beforeEach(reset);

  it("changing the request redoes DoD and plan in the same gesture", async () => {
    makeGoal(GOAL_STATUS.draft);
    const res = await edit({ request: "deliver a measurement report" });
    assert.equal(res.status, 200);
    const body = await read(res);
    assert.ok(body.dod?.length, "the response carries the new DoD");
    assert.ok(body.plan?.length, "and the plan");
    assert.ok(
      !body.dod!.some((d) => d.text === "previous criterion"),
      "the old DoD does not survive",
    );
    const stored = JSON.parse(goalRow()!.dod) as { text: string }[];
    assert.deepEqual(
      stored.map((d) => d.text),
      body.dod!.map((d) => d.text),
      "the database and the response say the same thing",
    );
    assert.match(
      stored[0]!.text,
      /deliver a measurement report/,
      "the DoD speaks of the new request",
    );
    assert.equal(JSON.parse(events("edit")[0]!.payload).dodInvalidated, true);
  });

  it("editing a rail does not touch the DoD: only the request makes it stale", async () => {
    makeGoal(GOAL_STATUS.draft);
    assert.equal((await edit({ budgetUsd: 9 })).status, 200);
    assert.deepEqual(
      (JSON.parse(goalRow()!.dod) as { text: string }[]).map((d) => d.text),
      ["previous criterion"],
    );
  });

  it("a failing generation does not lose the edit: 200, warning, DoD emptied", async () => {
    makeGoal(GOAL_STATUS.draft);
    const deps: GoalEditDeps = {
      regenerate: () => Promise.reject(new Error("model unreachable")),
    };
    const result = await editGoal(GOAL, { request: "another request" }, deps);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.warning!, /model unreachable/);
    assert.equal(goalRow()?.request, "another request", "the edit is written despite the failure");
    assert.deepEqual(
      JSON.parse(goalRow()!.dod),
      [],
      "the DoD is empty, so visibly to redo, never stale",
    );
    assert.equal(events("rail").length, 1, "the failure leaves a trace in the log");
  });
});

describe("POST /api/goals/:id/regenerate: recovery", () => {
  beforeEach(reset);

  const regen = (id = GOAL) => app.request(`/api/goals/${id}/regenerate`, { method: "POST" });

  it("redoes a draft goal's DoD without touching the request", async () => {
    makeGoal(GOAL_STATUS.draft, { dod: "[]", plan: "[]" });
    const res = await regen();
    assert.equal(res.status, 200);
    assert.ok((await read(res)).dod?.length);
    assert.ok((JSON.parse(goalRow()!.dod) as unknown[]).length > 0);
    assert.equal(goalRow()?.request, "do the thing");
  });

  it("an approved goal refuses: its DoD is the validated contract, and the loop ticks it", async () => {
    makeGoal(GOAL_STATUS.active);
    const res = await regen();
    assert.equal(res.status, 409);
    assert.match((await read(res)).error!, /the contract the human approved/);
    assert.deepEqual(
      (JSON.parse(goalRow()!.dod) as { text: string }[]).map((d) => d.text),
      ["previous criterion"],
    );
  });

  it("an unknown id: 404", async () => {
    assert.equal((await regen("ghost")).status, 404);
  });

  it("an upstream failure: 502, and the previous state holds", async () => {
    makeGoal(GOAL_STATUS.draft);
    const result = await regenerateGoalDod(GOAL, {
      regenerate: () => Promise.reject(new Error("model unreachable")),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 502);
    assert.match(result.error, /model unreachable/);
    assert.deepEqual(
      (JSON.parse(goalRow()!.dod) as { text: string }[]).map((d) => d.text),
      ["previous criterion"],
    );
  });
});

describe("the kill switch: cancelling is not a failure", () => {
  beforeEach(reset);

  it("POST /kill writes `cancelled`, not `failed`, and says so in the log", async () => {
    makeGoal(GOAL_STATUS.active);
    const res = await app.request(`/api/goals/${GOAL}/kill`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(goalRow()?.status, GOAL_STATUS.cancelled);
    assert.ok(goalRow()?.endedAt, "a stopped goal carries its end date");
    const payload = JSON.parse(events("status")[0]!.payload) as { status: string; killed: boolean };
    assert.deepEqual(payload, { status: GOAL_STATUS.cancelled, killed: true });
  });

  it("a `cancelled` goal stays deletable: deletion reads it as stopped", async () => {
    makeGoal(GOAL_STATUS.cancelled);
    const res = await app.request(`/api/goals/${GOAL}`, { method: "DELETE" });
    assert.equal(res.status, 200, "neither a live goal nor an unknown status");
    assert.equal(goalRow(), undefined);
  });
});
