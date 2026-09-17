// What the code weighs: nesting depth, and nothing else since 09/09.
//
// The four line counters that lived here (`files.over500`, `files.over800`, `functions.over100`,
// `functions.over200`) were removed by operator decision, backed by a measurement in statements,
// which no formatter moves: `builtin-skills.ts` had 581 lines for 28 statements and was flagged,
// while the biggest acquitted file had 216. In a repo whose comments are paragraphs, line counts
// measured prose and pointed at the wrong files. `complexity` (oxlint, threshold 15) replaces them.
//
// `nesting.over4` stays: it counts levels, not lines.
import { describe, it } from "node:test";
import { ratchet } from "./ratchet.js";

describe("size does not grow", () => {
  it("no file nests deeper than it already did", () => {
    ratchet("nesting.over4", "levels");
  });
});
