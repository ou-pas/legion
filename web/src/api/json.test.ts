import { describe, expect, it } from "vitest";
import { parseJsonOr } from "./json.js";

describe("parseJsonOr", () => {
  it("returns the value when the JSON reads", () => {
    expect(parseJsonOr<string[]>('["pr.md"]', [])).toEqual(["pr.md"]);
    expect(parseJsonOr<{ branch?: string }>('{"branch":"feat/x"}', {})).toEqual({
      branch: "feat/x",
    });
  });

  it("returns the fallback on a malformed value: what used to blank the page", () => {
    expect(parseJsonOr<string[]>("not json", [])).toEqual([]);
    expect(parseJsonOr<string[]>("[1,", [])).toEqual([]);
  });

  it('empty means "never had this field": "", null, undefined', () => {
    expect(parseJsonOr<string[]>("", [])).toEqual([]);
    expect(parseJsonOr<string[]>(null, [])).toEqual([]);
    expect(parseJsonOr<string[]>(undefined, [])).toEqual([]);
  });

  it('a literal "null" also yields the fallback: `.branch` on null would throw', () => {
    expect(parseJsonOr<{ branch?: string }>("null", {})).toEqual({});
  });
});
