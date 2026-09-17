// What happens when an account dies mid-work.
//
// The path that will run most often is NOT the switch but SLEEP: a one-subscription project takes
// it every time, a two-subscription one as soon as both are closed. So it is tested as much as the
// other: wake-up time, margin, and sleeping until the NEAREST reset rather than the dead account's.
//
// And the guard that costs most if it breaks: no A → B → A loop. Each attempt costs a container
// start.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planQuotaPause, WAKE_MARGIN_MS } from "./quota-plan.js";
import type { QuotaPauseInput } from "./quota-plan.js";

const NOW = Date.parse("2026-09-08T12:00:00Z");
const HOUR = 3_600_000;

const plan = (over: Partial<QuotaPauseInput>) =>
  planQuotaPause({
    rejection: { window: "five_hour", resetsAt: new Date(NOW + 2 * HOUR) },
    exhausted: { credentialId: "c1", label: "Personal" },
    next: { credentialId: "c2", label: "Work", available: true, retryAt: null },
    now: NOW,
    ...over,
  });

describe("the switch", () => {
  it("restarts at once when another project account is available", () => {
    const p = plan({});
    assert.equal(
      p.wakeAt?.getTime(),
      NOW,
      "wake-up at the current time: the next tick picks it up",
    );
    assert.equal(p.switchTo, "c2");
    assert.match(p.body, /“Work”/);
    assert.match(
      p.body,
      /“Personal”/,
      "the entry names BOTH accounts: the dying one and the one taking over",
    );
  });

  it("NEVER retries the account that just died", () => {
    // The real case: the SDK gave no reset time, so nothing could be written, so resolution still
    // returns the same one. Without this guard we would restart on it and die at once, one container
    // start per round, in a loop.
    const p = plan({
      rejection: { window: "five_hour", resetsAt: null },
      next: { credentialId: "c1", label: "Personal", available: true, retryAt: null },
    });
    assert.equal(p.switchTo, null);
    assert.equal(p.wakeAt, null, "manual wake-up: no other account and no reset time");
    assert.match(p.body, /gave no reset time/);
  });
});

describe("sleep", () => {
  it("sleeps until the account reset plus the margin when nobody else is there", () => {
    const p = plan({ next: { credentialId: null, label: null, available: true, retryAt: null } });
    assert.equal(p.switchTo, null);
    assert.equal(p.wakeAt?.getTime(), NOW + 2 * HOUR + WAKE_MARGIN_MS);
    assert.match(p.body, /I resume on my own/);
  });

  it("sleeps until the NEAREST reset among credentials, not the dead account's", () => {
    // The dead account reopens in 6 h, another project account in 1 h: sleeping until the first
    // would lose five hours of possible work.
    const p = plan({
      rejection: { window: "seven_day", resetsAt: new Date(NOW + 6 * HOUR) },
      next: { credentialId: "c2", label: "Work", available: false, retryAt: new Date(NOW + HOUR) },
    });
    assert.equal(p.wakeAt?.getTime(), NOW + HOUR + WAKE_MARGIN_MS);
    assert.equal(p.switchTo, null, "no account available: no switch, wait");
    assert.match(p.body, /exhausted too/, "the entry says why it sleeps despite several accounts");
  });

  it("a reset already past does not make a wake-up in the past", () => {
    const p = plan({
      rejection: { window: "five_hour", resetsAt: new Date(NOW - HOUR) },
      next: { credentialId: null, label: null, available: true, retryAt: null },
    });
    assert.equal(p.wakeAt?.getTime(), NOW + WAKE_MARGIN_MS);
  });

  it("names the account when it has a label, and stays generic otherwise", () => {
    const surRepli = plan({
      exhausted: { credentialId: null, label: null },
      next: { credentialId: null, label: null, available: true, retryAt: null },
    });
    assert.match(
      surRepli.body,
      /of the subscription is exhausted/,
      "on the fallback, no label to give",
    );
  });

  it("spells out the window: 5 h and week do not recover the same way", () => {
    const cinqH = plan({
      next: { credentialId: null, label: null, available: true, retryAt: null },
    });
    assert.match(cinqH.body, /5 h window/);
    const hebdo = plan({
      rejection: { window: "seven_day_opus", resetsAt: new Date(NOW + HOUR) },
      next: { credentialId: null, label: null, available: true, retryAt: null },
    });
    assert.match(hebdo.body, /week \(opus\) window/);
  });

  it("lets an unknown window through under its raw name rather than hiding it", () => {
    const p = plan({
      rejection: { window: "thirty_days", resetsAt: new Date(NOW + HOUR) },
      next: { credentialId: null, label: null, available: true, retryAt: null },
    });
    assert.match(p.body, /thirty_days window/);
  });
});
