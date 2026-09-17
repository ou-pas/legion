// The session spec contract, stitched back together by the compiler (lot 10, 10/09).
//
// `SessionSpec` is built here and read in the container. The two halves cannot share a type:
// `runner-payload/` may not import `server/` (the container does not ship the control plane), so
// the payload declares its own view, the fields it reads.
//
// This file checks one direction only: is the server's spec assignable to the payload's view?
// The other direction would be wrong, the server legitimately sends fields the payload ignores.
// A field renamed on the server fails now, at `pnpm typecheck`, instead of arriving `undefined`
// in the container at the first session; `make contract` does the same between the UI and the API.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionSpec as PayloadSpec } from "../../../../runner-payload/session-spec.mjs";
import type { SessionSpec } from "./types.js";

/** The day the server stops covering the payload's view, this line does not compile, and the
 *  message names the offending field. */
type ServerCoversPayload = SessionSpec extends PayloadSpec ? true : false;
const serverCoversPayload: ServerCoversPayload = true;

describe("the spec the container reads", () => {
  it("is fully provided by the one the server builds", () => {
    // The real assertion is the type above, held by the compiler; at runtime only a boolean is
    // left. The test exists so a type failure has a readable name in the suite, and so nobody
    // takes this file for dead code.
    assert.equal(serverCoversPayload, true);
  });
});
