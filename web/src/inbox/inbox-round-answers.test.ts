// What an answer says, in a word (07/09): the questionnaire rail and recap read a raw value
// (`"staging"`, `true`, `3`) and must show the label the human saw.
import { describe, expect, it } from "vitest";
import type { FormField } from "../api/inbox.js";
import {
  answerLabel,
  initialValues,
  isBlank,
  isDefaultAnswer,
  missingRequired,
} from "./inbox-round-answers.js";

const radio: FormField = {
  id: "r",
  label: "R",
  type: "radio",
  default: "b",
  options: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
  ],
};
const check: FormField = { id: "c", label: "C", type: "checkbox" };
const text: FormField = { id: "t", label: "T", type: "text", required: true };
const num: FormField = { id: "n", label: "N", type: "number", default: 3 };

describe("initialValues", () => {
  it("sets the agent default, `false` on a checkbox without default, nothing otherwise", () => {
    expect(initialValues([radio, check, text, num])).toEqual({ r: "b", c: false, n: 3 });
  });
});

describe("answerLabel", () => {
  it("a choice reads by its LABEL, not its id", () => {
    expect(answerLabel(radio, "a")).toBe("Alpha");
  });
  it("a checkbox reads yes or no; number and text as is; blank is null", () => {
    expect(answerLabel(check, true)).toBe("yes");
    expect(answerLabel(check, false)).toBe("no");
    expect(answerLabel(num, 3)).toBe("3");
    expect(answerLabel(text, "  ")).toBeNull();
  });
});

describe("isDefaultAnswer / isBlank / missingRequired", () => {
  it('the answer is "the recommendation" when it equals the default, and only if there is one', () => {
    expect(isDefaultAnswer(radio, "b")).toBe(true);
    expect(isDefaultAnswer(radio, "a")).toBe(false);
    expect(isDefaultAnswer(check, false)).toBe(false);
  });
  it("blank = absent, null, or a whitespace string; never `false` or `0`", () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(" ")).toBe(true);
    expect(isBlank(false)).toBe(false);
    expect(isBlank(0)).toBe(false);
  });
  it("missing required fields, in round order", () => {
    expect(missingRequired([radio, text], { r: "a" }).map((f) => f.id)).toEqual(["t"]);
  });
});
