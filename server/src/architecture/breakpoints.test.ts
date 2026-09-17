// The gate closing the breakpoint scale (13/09, responsive work, lot 1).
//
// On 13/09, twenty-eight media queries used ten distinct values; each screen had picked its own,
// so neighbouring surfaces switched twenty pixels apart. DESIGN.md rule 2 forbids hard-coded
// values but cannot help: a media query is the one place a token cannot go
// (`@media (max-width: var(--bp))` is not valid CSS).
//
// `scripts/arch-metrics.ts` (`breakpointsOffScale`) measures any `(max-width: Npx)` whose N is not
// one of the three steps in DESIGN.md § Width, and any `min-width`: the product is wide-screen
// first, a media query subtracts.
//
// A ratchet, not an absolute threshold: converting the fourteen off-scale values at once would be
// a visual change on fourteen surfaces no test reads. They are paid off in passing; the fifteenth
// is what is forbidden.
import { describe, it } from "node:test";
import { ratchet } from "./ratchet.js";

describe("the breakpoint scale is closed", () => {
  it("no media query outside the three steps, no min-width", () => {
    ratchet("breakpointsOffScale", "media query");
  });
});
