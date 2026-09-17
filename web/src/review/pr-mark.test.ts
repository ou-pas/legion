// The number is read from the URL when the forge did not return it, and never from anywhere else.
import { describe, expect, it } from "vitest";
import { prNumberOf } from "./pr-mark.js";

describe("a PR number, read from its URL", () => {
  it.each([
    ["https://github.com/ou-pas/legion/pull/112", 112],
    ["https://github.com/ou-pas/legion/pull/112/files", 112],
    ["https://github.com/ou-pas/legion/pull/112#issuecomment-1", 112],
    ["https://gitlab.example.com/grp/proj/-/merge_requests/7", 7],
  ])("%s → #%i", (url, n) => {
    expect(prNumberOf(url)).toBe(n);
  });

  it("does not invent a number", () => {
    expect(prNumberOf("https://github.com/ou-pas/legion/pulls")).toBeNull();
    expect(prNumberOf("https://github.com/ou-pas/legion/tree/feature/x")).toBeNull();
    expect(prNumberOf("https://github.com/ou-pas/legion/pull/abc")).toBeNull();
  });
});
