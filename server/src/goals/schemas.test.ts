// What the schemas decide on their own (06/09). `routes.test.ts` exercises them over HTTP; here we
// look at the three decisions they make alone, which read poorly in a route response: what is
// trimmed, "absent" versus "null", and an unknown key refused by name rather than silently dropped.
// No database: these schemas know nothing of the world, which is exactly the point.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approveGoalBody, createGoalBody, goalFromIssuesBody, goalPatchBody } from "./schemas.js";

describe("a goal's brief", () => {
  it("name and request are trimmed, so the route no longer does it by hand", () => {
    const parsed = createGoalBody.parse({
      projectId: "p1",
      name: "  Ship  ",
      request: "  do  ",
    });
    assert.equal(parsed.name, "Ship");
    assert.equal(parsed.request, "do");
  });

  it("a request made of spaces is refused: a goal without a request has nothing to orchestrate", () => {
    const r = createGoalBody.safeParse({ projectId: "p1", name: "n", request: "   " });
    assert.equal(r.success, false);
  });

  it("an unknown key is refused by name, not silently dropped", () => {
    const r = createGoalBody.safeParse({
      projectId: "p1",
      name: "n",
      request: "r",
      status: "active",
    });
    assert.equal(r.success, false);
    if (!r.success) assert.match(JSON.stringify(r.error.issues), /status/);
  });
});

describe("editing a goal", () => {
  it("`null` on a rail is a value: that is how a set cap is removed", () => {
    const parsed = goalPatchBody.parse({ budgetUsd: null, maxHours: null });
    assert.equal(parsed.budgetUsd, null);
    assert.equal(parsed.maxHours, null);
    assert.equal("maxNoProgress" in parsed, false, "what is not sent stays absent, not null");
  });

  it("an empty patch passes the schema: `goal-edit.ts` refuses it, by name", () => {
    assert.deepEqual(goalPatchBody.parse({}), {});
  });

  it("`maxNoProgress` is an integer: a fractional threshold makes no sense in rounds", () => {
    assert.equal(goalPatchBody.safeParse({ maxNoProgress: 2.5 }).success, false);
  });
});

describe("the other two bodies", () => {
  it("the reviewed DoD needs a text for each item, and the faulty path is named", () => {
    const r = approveGoalBody.safeParse({ items: [{ id: "d1" }] });
    assert.equal(r.success, false);
    if (!r.success)
      assert.match(r.error.issues.map((i) => i.path.join(".")).join(" "), /items\.0\.text/);
  });

  it("an import with no issue is refused: there would be nothing to process", () => {
    assert.equal(goalFromIssuesBody.safeParse({ projectId: "p1", issues: [] }).success, false);
  });
});
