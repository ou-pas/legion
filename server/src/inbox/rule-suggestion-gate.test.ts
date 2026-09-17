// `isFreeTextAnswer` alone decides whether an inbox answer may feed the memory-to-rule suggestion.
// On 03/09 form answers triggered it like handwritten sentences and saturated the quota of five
// with copied field ids.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFreeTextAnswer } from "./rule-suggestion-gate.js";

describe("isFreeTextAnswer", () => {
  it("accepts free text alone", () => {
    assert.equal(isFreeTextAnswer({ text: "always archive before deleting" }), true);
  });

  it("rejects a form submission (formData without text)", () => {
    assert.equal(
      isFreeTextAnswer({ formData: { goal_case: "archive", goal_mode: "cascade" } }),
      false,
    );
  });

  it("accepts free text overriding a form (human first)", () => {
    assert.equal(isFreeTextAnswer({ formData: { a: 1 }, text: "no, do X instead" }), true);
  });

  it("rejects a bare click (choiceId): nothing was written", () => {
    assert.equal(isFreeTextAnswer({ choiceId: "retry" }), false);
  });

  it("lets choiceId win over text: answerInbox keeps the choice label", () => {
    assert.equal(isFreeTextAnswer({ choiceId: "retry", text: "a whole paragraph" }), false);
  });

  it("accepts an empty answer by shape; length is a separate guard", () => {
    assert.equal(isFreeTextAnswer({}), true);
  });
});
