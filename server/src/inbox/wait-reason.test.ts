// Why a session waits: the rule, tested without a database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ON_ANSWER } from "./inbox-enums.js";
import {
  WAIT_REASON,
  WAIT_REASONS,
  deriveWaitReason,
  needsOperator,
  type WaitReason,
} from "./wait-reason.js";

describe("deriveWaitReason", () => {
  it("returns question by default", () => {
    assert.equal(deriveWaitReason({}), WAIT_REASON.question);
  });

  it("treats a task wait as a dependency", () => {
    assert.equal(deriveWaitReason({ waitForTaskId: "t1" }), WAIT_REASON.dependency);
  });

  it("treats a scheduled wake-up as an out-of-quota pause", () => {
    assert.equal(deriveWaitReason({ wakeAt: new Date() }), WAIT_REASON.quotaPause);
  });

  it("treats an approval request as a gate", () => {
    assert.equal(deriveWaitReason({ approval: true }), WAIT_REASON.approval);
  });

  it("treats `retry-task` as a failure diagnostic", () => {
    assert.equal(deriveWaitReason({ onAnswer: ON_ANSWER.retryTask }), WAIT_REASON.diagnostic);
  });

  // The order is the rule, matching `createInboxMessage`'s `waiting` vs `blocked` choice.
  it("never treats a self-waking wait as an approval", () => {
    assert.equal(deriveWaitReason({ approval: true, waitForTaskId: "t1" }), WAIT_REASON.dependency);
    assert.equal(deriveWaitReason({ approval: true, wakeAt: new Date() }), WAIT_REASON.quotaPause);
  });

  // No field tells an operator pause from a question; `pauseForOperator` names it.
  it("never guesses an operator pause", () => {
    for (const input of [{}, { approval: true }, { onAnswer: ON_ANSWER.retryTask }]) {
      assert.notEqual(deriveWaitReason(input), WAIT_REASON.operatorPause);
    }
  });
});

describe("needsOperator", () => {
  it("is true for the three reasons needing a human gesture", () => {
    assert.equal(needsOperator(WAIT_REASON.question), true);
    assert.equal(needsOperator(WAIT_REASON.approval), true);
    assert.equal(needsOperator(WAIT_REASON.diagnostic), true);
  });

  it("is false for self-waking waits and the operator's own pause", () => {
    assert.equal(needsOperator(WAIT_REASON.dependency), false);
    assert.equal(needsOperator(WAIT_REASON.quotaPause), false);
    assert.equal(needsOperator(WAIT_REASON.operatorPause), false);
  });

  it("answers for every reason", () => {
    for (const reason of WAIT_REASONS) {
      assert.equal(typeof needsOperator(reason), "boolean", `unhandled reason: ${reason}`);
    }
  });
});

describe("WAIT_REASON", () => {
  // `satisfies` guarantees every named value is a reason; this checks the converse.
  it("names every reason in the list", () => {
    const named = new Set<WaitReason>(Object.values(WAIT_REASON));
    for (const reason of WAIT_REASONS) {
      assert.ok(named.has(reason), `reason missing from WAIT_REASON: ${reason}`);
    }
    assert.equal(named.size, WAIT_REASONS.length);
  });
});
