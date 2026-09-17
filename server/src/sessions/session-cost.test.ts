// The three costs of a run, a session and a task (lot 11).
//
// The 10/09 regression: a resumed session's cost only showed its last resume. A restarting session
// must ADD, never overwrite, and the task total must count the current session at its new value,
// which the database does not carry yet when the event leaves.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCostOf, sessionCostAfter, taskCostAfter } from "./session-cost.js";

describe("runCostOf: the cost of the run that just finished", () => {
  it("reads `costUsd` on a `result`", () => {
    assert.equal(runCostOf("result", { costUsd: 3.4 }), 3.4);
  });

  it("returns 0 when the run cost nothing, not `null`: zero is a measurement", () => {
    assert.equal(runCostOf("result", { costUsd: 0 }), 0);
  });

  it("ignores any other event type, even carrying a `costUsd`", () => {
    assert.equal(runCostOf("throttle", { costUsd: 9 }), null);
  });

  it("returns `null` when the payload is missing, empty, or carries no number", () => {
    assert.equal(runCostOf("result", null), null);
    assert.equal(runCostOf("result", {}), null);
    assert.equal(runCostOf("result", { costUsd: "3.40" }), null);
  });
});

describe("sessionCostAfter: the sum of a session's runs", () => {
  it("adds instead of overwriting: the 10/09 regression", () => {
    // RPXUHq0upSK-: three runs at 0.94, then 0, then 3.40; the row said 3.40 instead of 4.34.
    let spent: number | null = null;
    for (const run of [0.94, 0, 3.4]) spent = sessionCostAfter(spent, run);
    assert.equal(Number(spent!.toFixed(2)), 4.34);
  });

  it("starts from zero when the session had spent nothing", () => {
    assert.equal(sessionCostAfter(null, 1.25), 1.25);
  });
});

describe("taskCostAfter: the task total across sessions", () => {
  const sessions = [
    { id: "s1", costUsd: 2 },
    { id: "s2", costUsd: 0.5 },
    { id: "s3", costUsd: null },
  ];

  it("counts the current session at its NEW value, not the database's", () => {
    assert.equal(taskCostAfter(sessions, "s2", 4), 6);
  });

  it("reads `null` as zero: a session without reported cost does not cancel the total", () => {
    assert.equal(taskCostAfter(sessions, "s3", 1), 3.5);
  });

  it("rounds to a tenth of a cent: an amount to read, not a sum to reconcile", () => {
    assert.equal(taskCostAfter([{ id: "s1", costUsd: 0 }], "s1", 1 / 3), 0.3333);
  });

  it("counts ONLY the rows received: the writing session is always among them", () => {
    // Its row exists since `runTask`'s reservation, so an id missing from the list is a caller bug,
    // not a case to cover, and the sum shows it.
    assert.equal(taskCostAfter([], "s1", 7.5), 0);
  });
});
