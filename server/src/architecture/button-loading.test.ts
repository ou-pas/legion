// The gate that keeps silent buttons from coming back (16/09, spec 2jan8IZn61: "a button that
// calls the server shows that it is waiting").
//
// 23 places in `web/src` (5 more found while writing this rule) discarded their handler's promise
// (`void call()`, or a `.then/.catch/.finally` never returned) in the `onClick`/`onConfirm` of a
// `Button`, `IconBtn` or `ConfirmAction`. `ui/busy.ts` spins them only if the handler returns its
// promise. `scripts/arch-metrics.ts` (`discardedButtonPromises`) measures, `mustBeZero` judges, as
// for `navRedirectLinks`.
//
// An explicit `loading` prop exempts the element: it is the other legitimate way to drive the
// spinner (e.g. `adopting`/`forgetting` in `connections-card.tsx`). This rule only judges the case
// where nobody drives anything.
import { describe, it } from "node:test";
import { mustBeZero } from "./ratchet.js";

describe("a button that calls the server shows that it is waiting", () => {
  it("no Button, IconBtn or ConfirmAction onClick/onConfirm discards its promise", () => {
    mustBeZero(
      "discardedButtonPromises",
      "this handler discards its call's promise (`void`, or a `.then/.catch/.finally` never " +
        "returned) without an explicit `loading` prop, so the `ui/busy.ts` spinner cannot " +
        "fire. Return the promise (`onClick={() => call().then(...)}`), or drive the " +
        "spinner yourself with `loading={someState}` if you already have a state at hand.",
    );
  });
});
