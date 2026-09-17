// Direct writes to standard output (05/09).
//
// Server side, `console.*` was the product's log (83 calls) and replacing it is a project, so the
// count is frozen. Screen side, a forgotten `console.log` ships to the user's console with whatever
// it carried; the repo is at zero, so an absolute threshold holds.
import { describe, it } from "node:test";
import { mustBeZero, ratchet } from "./ratchet.js";

describe("standard output", () => {
  it("no new `console.*` call on the server or in the runner", () => {
    ratchet("consoleCalls", "calls", (file) => !file.startsWith("web/"));
  });

  it("no `console.*` on the screen side", () => {
    mustBeZero(
      "consoleCalls",
      "a `console.*` appeared in `web/src`: it will ship to production, in the user's console.",
      (file) => file.startsWith("web/"),
    );
  });
});
