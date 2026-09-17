// What an agent may request on its own task (lot 11).
//
// plan.md's invariant: an agent token NEVER finishes a gated task. Three gates overlap, each with its
// own message, because they call for three different operator gestures: approve a batch, judge
// criteria, tick a box.
//
// `templateId: null` unless stated: `lotApprovalOnly` then short-circuits without the database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentStatusRefusal, inertReviewRequest, type GatedTask } from "./agent-task-gate.js";

const task = (over: Partial<GatedTask> = {}): GatedTask => ({
  status: "doing",
  criteria: null,
  approvalGate: false,
  templateId: null,
  stepIndex: null,
  ...over,
});

const CRITERIA = JSON.stringify({
  validatedBy: "operator",
  items: [{ text: "it compiles", mode: "test" }],
});

describe("agentStatusRefusal: the refusals the /internal port gives an agent", () => {
  it("lets an ordinary task go to done", () => {
    assert.equal(agentStatusRefusal(task(), "done"), null);
  });

  it("lets doing and review through without asking anything", () => {
    assert.equal(agentStatusRefusal(task({ criteria: CRITERIA }), "review"), null);
    assert.equal(agentStatusRefusal(task({ criteria: CRITERIA }), "doing"), null);
  });

  it("refuses done on a gated task, naming the human", () => {
    assert.match(
      agentStatusRefusal(task({ approvalGate: true }), "done") ?? "",
      /only the human can mark this task done/,
    );
  });

  it("refuses done on a task with criteria, even without the flag", () => {
    // The gate is not only `approvalGate`: criteria carry it too, so a task with criteria stays
    // closed if the flag was unticked by hand.
    assert.match(
      agentStatusRefusal(task({ criteria: CRITERIA, approvalGate: false }), "done") ?? "",
      /only the operator finishes this task/,
    );
  });

  it("refuses a task with criteria IN REVIEW relaunching itself", () => {
    assert.match(
      agentStatusRefusal(task({ status: "review", criteria: CRITERIA }), "doing") ?? "",
      /from review, only they run it again/,
    );
  });

  it("lets a task WITHOUT criteria go from review back to doing", () => {
    assert.equal(agentStatusRefusal(task({ status: "review" }), "doing"), null);
  });

  it("refuses nothing when the agent requests no status: it only files a note", () => {
    assert.equal(
      agentStatusRefusal(task({ criteria: CRITERIA, approvalGate: true }), undefined),
      null,
    );
  });

  it("unreadable criteria do not close the task: the flag stays the only judge", () => {
    assert.equal(agentStatusRefusal(task({ criteria: "{not json" }), "done"), null);
  });
});

describe("inertReviewRequest: the review request that must not ring anything", () => {
  it("true when a task with criteria ALREADY in review requests review again", () => {
    assert.equal(
      inertReviewRequest(task({ status: "review", criteria: CRITERIA }), "review"),
      true,
    );
  });

  it("false without criteria: the transition table decides alone", () => {
    assert.equal(inertReviewRequest(task({ status: "review" }), "review"), false);
  });

  it("false when the task is not in review yet: the transition has an effect", () => {
    assert.equal(
      inertReviewRequest(task({ status: "doing", criteria: CRITERIA }), "review"),
      false,
    );
  });

  it("false for any other requested status", () => {
    assert.equal(inertReviewRequest(task({ status: "review", criteria: CRITERIA }), "done"), false);
  });
});
