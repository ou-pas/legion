import { describe, expect, it } from "vitest";
import { choiceLayout } from "./choice-layout.js";

describe("choiceLayout", () => {
  it("keeps buttons inline for short, even choices", () => {
    expect(choiceLayout(["Risks", "Benefits"])).toBe("inline");
    expect(choiceLayout([])).toBe("inline");
  });

  it("switches to a vertical list beyond 28 characters for one label", () => {
    expect(choiceLayout(["Provide a PHP environment in the session"])).toBe("stacked");
    // Exactly 28 characters: still inline, the threshold is strictly exceeded.
    expect(choiceLayout(["a".repeat(28)])).toBe("inline");
    expect(choiceLayout(["a".repeat(29)])).toBe("stacked");
  });

  it("switches when the gap between shortest and longest exceeds 28 characters", () => {
    // "yes" (3) vs a 90-character sentence. A gap above 28 necessarily implies a label above 28
    // (lengths are positive): both branches overlap here, as expected, since the rule is a
    // disjunction, not a partition.
    expect(choiceLayout(["yes", "a".repeat(90)])).toBe("stacked");
    expect(choiceLayout(["short", "a".repeat(5 + 29)])).toBe("stacked");
  });

  it("one long choice switches the WHOLE group, never half and half", () => {
    const labels = ["yes", "no", "Write the test anyway without being able to run it"];
    expect(choiceLayout(labels)).toBe("stacked");
  });
});
