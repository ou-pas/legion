// The trap this module closes: `Number("12a")` is NaN, and `JSON.stringify(NaN)` gives `null`, which
// the server reads as "no cap". A typo in the budget would have REMOVED a running goal's budget while
// trying to fix it.
import { describe, expect, it } from "vitest";
import { railsDraftOf, railsPatch } from "./goal-rails-draft.js";

describe("railsDraftOf: rails as shown in the fields", () => {
  it("a missing cap is an EMPTY field, not a zero", () => {
    expect(railsDraftOf({ budgetUsd: null, maxDurationMs: null, maxNoProgress: 3 })).toEqual({
      budget: "",
      hours: "",
      noProgress: "3",
    });
  });

  it("duration goes from database ms to API hours, without float decimals", () => {
    expect(railsDraftOf({ budgetUsd: 25, maxDurationMs: 1_800_000, maxNoProgress: 5 })).toEqual({
      budget: "25",
      hours: "0.5",
      noProgress: "5",
    });
  });
});

describe("railsPatch: three text fields to a patch", () => {
  it('an empty field is `null`: "no cap" is a value, not an absence', () => {
    expect(railsPatch({ budget: "", hours: "", noProgress: "3" })).toEqual({
      budgetUsd: null,
      maxHours: null,
      maxNoProgress: 3,
    });
  });

  it("readable numbers pass as is", () => {
    expect(railsPatch({ budget: "40.5", hours: "2", noProgress: "7" })).toEqual({
      budgetUsd: 40.5,
      maxHours: 2,
      maxNoProgress: 7,
    });
  });

  it.each([
    ["a budget that is not a number", { budget: "12a", hours: "2", noProgress: "3" }],
    ["a negative budget", { budget: "-3", hours: "2", noProgress: "3" }],
    ["a zero duration", { budget: "", hours: "0", noProgress: "3" }],
    ["an empty no-progress threshold", { budget: "", hours: "", noProgress: "" }],
    ["a decimal no-progress threshold", { budget: "", hours: "", noProgress: "2.5" }],
  ])("refuses %s: nothing goes to the server", (_, draft) => {
    expect(railsPatch(draft)).toBeNull();
  });
});
