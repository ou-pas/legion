// The decision domain of the red-CI watcher: pure functions, no database, no network. The tick
// itself (`ci-watch-tick.ts`) is thin orchestration around these; what to do belongs here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHECK_STATE } from "../integrations/forge.js";
import {
  CI_WATCH_CAP,
  ciWatchAttemptLine,
  ciWatchEnabledFor,
  decideCiWatchAction,
  foldCiWatchState,
  INITIAL_CI_WATCH_STATE,
  type CiWatchState,
} from "./ci-watch.js";

const zero: CiWatchState = { attempts: 0, notified: false };

describe("decideCiWatchAction", () => {
  it("resets on green, whatever the counter so far", () => {
    const busy: CiWatchState = { attempts: 2, notified: false };
    assert.equal(decideCiWatchAction({ checkState: CHECK_STATE.passing, state: busy }), "reset");
  });

  it("does nothing on pending — never act on uncertainty", () => {
    assert.equal(decideCiWatchAction({ checkState: CHECK_STATE.pending, state: zero }), "nothing");
  });

  it("does nothing on unknown — never act on uncertainty", () => {
    assert.equal(decideCiWatchAction({ checkState: CHECK_STATE.unknown, state: zero }), "nothing");
  });

  it("launches on red while attempts remain under the cap", () => {
    for (let attempts = 0; attempts < CI_WATCH_CAP; attempts++) {
      const state: CiWatchState = { attempts, notified: false };
      assert.equal(
        decideCiWatchAction({ checkState: CHECK_STATE.failing, state }),
        "launch",
        `attempt ${attempts + 1}/${CI_WATCH_CAP} should still launch`,
      );
    }
  });

  it("notifies exactly once once the cap is spent", () => {
    const exhausted: CiWatchState = { attempts: CI_WATCH_CAP, notified: false };
    assert.equal(
      decideCiWatchAction({ checkState: CHECK_STATE.failing, state: exhausted }),
      "notify",
    );
  });

  it("does nothing on every tick after the notification was sent", () => {
    const alreadyNotified: CiWatchState = { attempts: CI_WATCH_CAP, notified: true };
    assert.equal(
      decideCiWatchAction({ checkState: CHECK_STATE.failing, state: alreadyNotified }),
      "nothing",
    );
  });

  it("honours a custom cap (never hardcoded twice)", () => {
    const state: CiWatchState = { attempts: 1, notified: false };
    assert.equal(decideCiWatchAction({ checkState: CHECK_STATE.failing, state }, 1), "notify");
  });
});

describe("foldCiWatchState: what a tick's outcome does to the counter", () => {
  it("green resets the counter, even mid-cap", () => {
    const state: CiWatchState = { attempts: 2, notified: false };
    assert.deepEqual(foldCiWatchState(state, "green"), INITIAL_CI_WATCH_STATE);
  });

  it("a launched fix counts as an attempt", () => {
    assert.deepEqual(foldCiWatchState(zero, "fix-launched"), { attempts: 1, notified: false });
  });

  it("a fixCi refusal (session active, 409, 502) does not count as an attempt", () => {
    const state: CiWatchState = { attempts: 1, notified: false };
    assert.deepEqual(foldCiWatchState(state, "fix-refused"), state);
  });

  it("a sent notification is remembered, attempts untouched", () => {
    const exhausted: CiWatchState = { attempts: CI_WATCH_CAP, notified: false };
    assert.deepEqual(foldCiWatchState(exhausted, "notified"), {
      attempts: CI_WATCH_CAP,
      notified: true,
    });
  });
});

describe("ciWatchEnabledFor: the per-project switch, and the demo project exclusion", () => {
  it("watches when the switch is on and the project is not the demo one", () => {
    assert.equal(ciWatchEnabledFor({ ciWatch: true, demo: false }), true);
  });

  it("does nothing when the switch is off", () => {
    assert.equal(ciWatchEnabledFor({ ciWatch: false, demo: false }), false);
  });

  it("excludes the demo project even with the switch on", () => {
    assert.equal(ciWatchEnabledFor({ ciWatch: true, demo: true }), false);
  });
});

describe("ciWatchAttemptLine", () => {
  it("names the repo, the PR and the attempt out of the cap", () => {
    assert.equal(
      ciWatchAttemptLine("backend", 42, 2),
      "CI red on backend#42, automatic attempt 2/3",
    );
  });
});
