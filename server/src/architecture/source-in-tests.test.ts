// A test that reads the source it checks instead of calling it (11/09, completed 12/09).
//
// The structure work (09/09) asked every domain lot to remove these assertions. Measured at both
// ends of the structure work (lots 1 to 13): 53 → 54 `readFileSync` in tests, same 20 files. The
// task was in every lot brief and skipped thirteen times, with no gate to say so.
//
// Two ratchets since the 12/09 review (task CGmoJHm7Hz): reads (`readFileSync`) and the assertions
// derived from them. The first alone (#166) missed the very gesture this file exists to stop: one
// read can carry many assertions (`graceful-stop.test.ts`: one read, 25 assertions), and adding
// another on an already-read source incremented nothing. The second counts assertion calls with
// an argument referencing, anywhere in the call, a variable derived from a `readFileSync`.
//
// Both counters are deliberately coarse: neither tells a read of the tested source from a read of
// a file the test wrote itself (an artifact, a fixture). Telling them apart would need tracking
// every path, a finer gate than the `grep` that measured the drift. Hence `sourceReadInTests`
// (calls, counted by the compiler) does not exactly match the audit's textual "53 → 54".
//
// Not guarded yet: `readFile` from `fs/promises`, or `execFileSync("cat", …)` (already used in
// `server/src/infra/fleet-images.test.ts`).
import { describe, it } from "node:test";
import { ratchet } from "./ratchet.js";

describe("a test reads no more source than before to check what it verifies", () => {
  it("no test file calls `readFileSync` more often than at its last measure", () => {
    ratchet("sourceReadInTests", "source reads");
  });

  it("no test file asserts on already-read source more often than at its last measure", () => {
    ratchet("sourceAssertionsInTests", "assertions on read source");
  });
});
