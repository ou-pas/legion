// The module ships in the session image and is imported as is: THE CODE THAT RUNS is what is tested
// (same pattern as commit-convention.test.ts).
//
// The case measured on 03/09 on `xHt_lTLVWl`: six consecutive sessions, a `success`-subtype `result`
// carrying "API Error: 529 Overloaded", exitCode 0, task settled in review as finished work.
// `turnFailed` reads `is_error`, the field the SDK does not falsify, rather than guessing from text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  endsNothing,
  resultEventFields,
  turnFailed,
} from "../../../runner-payload/turn-outcome.mjs";

describe("turnFailed: the signal that does not lie", () => {
  it("an ordinary success is not a failure", () => {
    assert.equal(turnFailed({ subtype: "success", is_error: false }), false);
  });

  it("the measured case: subtype success, but is_error true (529 Overloaded)", () => {
    assert.equal(turnFailed({ subtype: "success", is_error: true, api_error_status: 529 }), true);
  });

  it("an SDK error subtype stays a failure, even without explicit is_error", () => {
    assert.equal(turnFailed({ subtype: "error_max_turns", is_error: undefined }), true);
  });

  it("auth or network error: same mechanism, no need to know the text", () => {
    assert.equal(turnFailed({ subtype: "success", is_error: true, api_error_status: 401 }), true);
    assert.equal(turnFailed({ subtype: "error_during_execution", is_error: true }), true);
  });
});

describe("resultEventFields: what the session trace publishes", () => {
  it("carries isError and apiErrorStatus besides the fields the control plane already reads", () => {
    const fields = resultEventFields({
      subtype: "success",
      is_error: true,
      api_error_status: 529,
      total_cost_usd: 0.0036,
      num_turns: 1,
    });
    assert.deepEqual(fields, {
      subtype: "success",
      costUsd: 0.0036,
      numTurns: 1,
      // The SDK gave no duration for this turn: `null`, not zero; "unknown" and "took no time" do not
      // read the same in a panel.
      durationMs: null,
      durationApiMs: null,
      isError: true,
      apiErrorStatus: 529,
    });
  });

  it("records the run's duration, which only the SDK knows", () => {
    // The session row only gives `endedAt - startedAt`, wall time: on a resumed session most of that
    // gap is the wait between resumes.
    const fields = resultEventFields({
      subtype: "success",
      total_cost_usd: 1,
      num_turns: 3,
      duration_ms: 1_340_000,
      duration_api_ms: 1_210_000,
    });
    assert.equal(fields.durationMs, 1_340_000);
    assert.equal(fields.durationApiMs, 1_210_000);
  });

  it("apiErrorStatus is null when the SDK does not know it", () => {
    const fields = resultEventFields({
      subtype: "success",
      is_error: false,
      total_cost_usd: 1.2,
      num_turns: 4,
    });
    assert.equal(fields.apiErrorStatus, null);
    assert.equal(fields.isError, false);
  });
});

// The `result`'s second lie (14/09). On resume, the SDK emits one BEFORE any work: zero turns, a
// few hundred milliseconds. The runner closed the input stream on it, and the real turn that
// followed ran without tools, every call refused or cut. Three tasks were settled as DELIVERED that
// way, including an interview writing that all its tools were cut.
describe("endsNothing: the result that concludes no work", () => {
  it("the measured case: zero turns, success, a few hundred milliseconds", () => {
    assert.equal(
      endsNothing({ subtype: "success", is_error: false, num_turns: 0, duration_ms: 441 }),
      true,
    );
  });

  it("a turn that produced something does conclude", () => {
    assert.equal(endsNothing({ subtype: "success", is_error: false, num_turns: 2 }), false);
  });

  // A turn FAILING at zero turns does end something: the session. Mistaking it for the synthetic
  // result would leave a container running on an API error, the 03/09 defect in reverse.
  it("a failure at zero turns is NOT a synthetic result", () => {
    assert.equal(
      endsNothing({ subtype: "success", is_error: true, api_error_status: 529, num_turns: 0 }),
      false,
    );
    assert.equal(endsNothing({ subtype: "error_during_execution", num_turns: 0 }), false);
  });

  // A truncated message (session killed mid-flight, fixture) lacks the field: it must not be taken
  // for zero, otherwise a real turn end would stay open until the safety net.
  it("a missing `num_turns` is not zero", () => {
    assert.equal(endsNothing({ subtype: "success", is_error: false }), false);
  });
});
