// The two push rules that break silently (13/09): the event filter and the decision to delete a
// subscription. Too wide a filter gets the phone muted, too narrow one hides a gate, and an
// over-eager deletion unsubscribes the operator during a transient vendor outage. Nobody is told
// in any of the three cases.
//
// The rest of `push.ts` touches the database and the network and is not exercised here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGonePushStatus, subscriptionWants } from "./push.js";
import type { PushSubscriptionRow } from "./push-store.js";

function row(events: string[]): PushSubscriptionRow {
  return {
    id: "p1",
    endpoint: "https://web.push.apple.com/xyz",
    p256dh: "key",
    auth: "key",
    events: JSON.stringify(events),
    label: "iPhone",
    createdAt: new Date(0),
    lastSeenAt: new Date(0),
  };
}

describe("subscriptionWants", () => {
  // Same convention as webhooks on purpose: two event lists side by side on one screen that meant
  // different things would be a trap.
  it("lets everything through when the list is empty", () => {
    assert.equal(subscriptionWants(row([]), "gate_waiting"), true);
    assert.equal(subscriptionWants(row([]), "pr_created"), true);
  });

  it("lets only the listed events through", () => {
    const picked = row(["gate_waiting", "task_failed"]);
    assert.equal(subscriptionWants(picked, "gate_waiting"), true);
    assert.equal(subscriptionWants(picked, "pr_created"), false);
  });
});

describe("isGonePushStatus", () => {
  it("treats as dead only a subscription the service declares dead", () => {
    assert.equal(isGonePushStatus(404), true);
    assert.equal(isGonePushStatus(410), true);
  });

  // The costliest mistake: a ten-minute vendor outage would unsubscribe the phone for good.
  it("deletes nothing on a transient or unknown failure", () => {
    for (const status of [429, 500, 502, 403, undefined])
      assert.equal(isGonePushStatus(status), false);
  });
});
