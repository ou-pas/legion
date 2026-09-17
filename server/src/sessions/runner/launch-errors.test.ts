// Launch refusals are told apart by their type, no longer by a word in the message (05/09).
// `runTask` reads `instanceof NoCapacityError` to queue; the other two go up to the operator.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NoCapacityError, NoDiskError, NoReachableRunnerError } from "./launch-errors.js";

describe("typed launch refusals", () => {
  it("each refusal is an Error, is recognised by `instanceof`, carries its name and keeps its message", () => {
    const cases = [
      [NoCapacityError, "NoCapacityError"],
      [NoReachableRunnerError, "NoReachableRunnerError"],
      [NoDiskError, "NoDiskError"],
    ] as const;
    for (const [Refusal, name] of cases) {
      const err = new Refusal("the operator's message");
      assert.ok(err instanceof Error);
      assert.ok(err instanceof Refusal);
      assert.equal(err.name, name);
      assert.equal(err.message, "the operator's message");
    }
  });

  it("one refusal is not another, which is what lets the queue take ONLY capacity", () => {
    // The message can say anything, including "capacity": it no longer decides anything.
    const disk = new NoDiskError("no runner has enough disk — at capacity, it seems");
    const asleep = new NoReachableRunnerError("no reachable runner");
    assert.ok(!(disk instanceof NoCapacityError));
    assert.ok(!(asleep instanceof NoCapacityError));
    assert.ok(!(new NoCapacityError("all runners at capacity") instanceof NoDiskError));
  });
});
