// The gate that keeps redirected addresses from coming back (nav work, lot G, 12/09).
//
// Six lots fixed every internal link aiming at a redirecting address (`/infra`, `/tasks/$taskId`,
// bare `/p/$projectId/capabilities`, etc.). Nothing stopped a seventh link from targeting the same
// dead address tomorrow.
//
// `scripts/arch-metrics.ts` (`navRedirectLinks`) measures every literal `to` (JSX attribute or
// object property) aiming at an address on the script's blocklist, outside `web/src/router.tsx`
// which declares them. This file judges with an absolute threshold: the repo is already at zero.
import { describe, it } from "node:test";
import { mustBeZero } from "./ratchet.js";

describe("no internal link aims at a redirecting address", () => {
  it("no literal `to` points to an address replaced by the nav work", () => {
    mustBeZero(
      "navRedirectLinks",
      "this address redirects (nav work, lots A-F): point to the canonical address. " +
        "The mapping is commented in scripts/arch-metrics.ts " +
        "(NAV_REDIRECT_TARGETS); web/src/router.tsx still serves the old address, do not remove it.",
    );
  });
});
