// What typing concedes (05/09). `!`, `any`, `as unknown as`: three ways to tell the compiler "be
// quiet, I know". None is an error; each is an unchecked promise, paid at runtime on a case the
// test did not cover. The repo carried 178 + 18 + 9; it will not carry 179.
import { describe, it } from "node:test";
import { mustBeZero, ratchet } from "./ratchet.js";

describe("typing concedes no more than yesterday", () => {
  it("no new non-null `!`, and no file gains one", () => {
    ratchet("nonNull", "occurrences");
  });

  // `any` is concentrated in `http/smoke.ts` (a harness, not product) and one line of the HTTP
  // client. When a third place appears, we want to see it named.
  it("no new `any`", () => {
    ratchet("anyKeyword", "occurrences");
  });

  it("no new `as unknown as`", () => {
    ratchet("asUnknown", "occurrences");
  });

  // Absolute threshold: the repo is already at zero. A default export breaks safe renaming and lets
  // the module name drift from the symbol's; CSF3 stories are the only exception, excluded by the
  // measurer itself.
  it("no default export outside stories", () => {
    mustBeZero("defaultExports", "a default export appeared outside a CSF3 story.");
  });
});
