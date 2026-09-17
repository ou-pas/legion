// What the task awaits from the operator, the rule alone. The LAST case matters: without it the action
// band would frame a component rendering `null` and show an empty sheet atop every conversation.
import { describe, expect, it } from "vitest";
import { CHANNEL_DECISION, channelDecision } from "./decision.js";
import { TASK_STATUS } from "../api/tasks.js";

describe("channelDecision", () => {
  it("names the failure before anything else: a dead session is not deposited work", () => {
    expect(
      channelDecision({
        status: TASK_STATUS.review,
        approvalGate: true,
        failure: "container disparu",
      }),
    ).toBe(CHANNEL_DECISION.failed);
    // Even in `doing` and without gate: the end reason decides, not the status.
    expect(
      channelDecision({ status: TASK_STATUS.doing, approvalGate: false, failure: "oom" }),
    ).toBe(CHANNEL_DECISION.failed);
  });

  it("a task in review without failure awaits approval", () => {
    expect(channelDecision({ status: TASK_STATUS.review, approvalGate: true, failure: null })).toBe(
      CHANNEL_DECISION.now,
    );
    // The gate is not the condition: `review` already is the wait.
    expect(channelDecision({ status: TASK_STATUS.review, approvalGate: false })).toBe(
      CHANNEL_DECISION.now,
    );
  });

  it("a gate announced during work says what will come", () => {
    expect(channelDecision({ status: TASK_STATUS.doing, approvalGate: true, failure: null })).toBe(
      CHANNEL_DECISION.later,
    );
  });

  it("returns null when there is nothing to decide: the band has nothing to frame", () => {
    expect(
      channelDecision({ status: TASK_STATUS.doing, approvalGate: false, failure: null }),
    ).toBeNull();
    expect(
      channelDecision({ status: TASK_STATUS.done, approvalGate: false, failure: null }),
    ).toBeNull();
    expect(channelDecision({ status: TASK_STATUS.todo, approvalGate: false })).toBeNull();
  });
});
