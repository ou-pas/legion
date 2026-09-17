// What has neither stories nor a test next to it (05/09). CLAUDE.md asks for a `<name>.stories.tsx`
// next to every module, and 98 screen modules never had one. What was missing was not the rule
// but something that refuses the 99th.
//
// Both metrics are pure membership, no number: removing a baseline line is exactly the gesture
// that pays back, like removing a line from `scripts/api-pending.json`.
import { describe, it } from "node:test";
import { ratchet } from "./ratchet.js";

describe("colocation does not degrade", () => {
  it("no new screen module without `.stories.tsx` or `.test.tsx`", () => {
    ratchet("storiesMissing", "");
  });

  it("no new server module without `.test.ts`", () => {
    ratchet("testsMissing", "");
  });
});
