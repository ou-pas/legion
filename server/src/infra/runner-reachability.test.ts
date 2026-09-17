// The threshold is two periods. One would drop any machine that coughed once; three would route
// to a sleeping Mac for a minute and a half. Pure function: no database, no fake daemon.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RUNNER_KIND } from "../shared/enums.js";
import { PROBE_PERIOD_MS, UNREACHABLE_AFTER_MS, runnerReachable } from "./runner-reachability.js";

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);

describe("runnerReachable: the threshold is two periods", () => {
  it("a `process` runner is reachable even if never probed", () => {
    assert.equal(runnerReachable({ kind: RUNNER_KIND.process, lastSeenAt: null }), true);
  });

  it("a never-probed docker runner is not reachable: a machine is not guessed", () => {
    assert.equal(runnerReachable({ kind: RUNNER_KIND.docker, lastSeenAt: null }), false);
  });

  it("an answer ONE period ago: still reachable (hysteresis absorbs the hiccup)", () => {
    assert.equal(
      runnerReachable({ kind: RUNNER_KIND.docker, lastSeenAt: new Date(T0 - PROBE_PERIOD_MS) }, T0),
      true,
    );
  });

  it("an answer TWO periods ago: unreachable", () => {
    assert.equal(
      runnerReachable(
        { kind: RUNNER_KIND.docker, lastSeenAt: new Date(T0 - UNREACHABLE_AFTER_MS) },
        T0,
      ),
      false,
    );
  });
});
