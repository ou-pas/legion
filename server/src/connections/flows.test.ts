// Flows in progress, in memory on purpose (a flow lives minutes; a restart mid-flow is harmless).
// The server keeps the exchange secret (`device_code` at GitHub); the browser gets an opaque `flowId`
// that trades for nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { openFlow, readFlow, closeFlow, flowCount } = await import("./flows.js");
const { PROVIDER } = await import("./providers.js");

describe("flow registry", () => {
  it("returns an opaque flowId, different from the exchange secret", () => {
    const id = openFlow({
      provider: PROVIDER.github,
      projectId: "p1",
      exchange: "dc_abc",
      expiresAt: Date.now() + 60_000,
    });
    assert.notEqual(id, "dc_abc");
    assert.equal(readFlow(id, PROVIDER.github)?.exchange, "dc_abc");
  });

  it("forgets a closed flow", () => {
    const id = openFlow({
      provider: PROVIDER.github,
      projectId: "p1",
      exchange: "dc_x",
      expiresAt: Date.now() + 60_000,
    });
    closeFlow(id);
    assert.equal(readFlow(id, PROVIDER.github), null);
  });

  it("treats an expired flow as absent", () => {
    const id = openFlow({
      provider: PROVIDER.github,
      projectId: "p1",
      exchange: "dc_y",
      expiresAt: Date.now() - 1,
    });
    assert.equal(readFlow(id, PROVIDER.github), null);
  });

  it("returns null for an unknown flowId", () => {
    assert.equal(readFlow("never-opened", PROVIDER.github), null);
  });

  // A: one provider's exchange secret must never go to another. A flow not owned by the caller is
  // indistinguishable from an unknown one, but is not deleted: its owner polls it.
  it("A: does not return another provider's flow, nor destroy it", () => {
    const id = openFlow({
      provider: PROVIDER.github,
      projectId: "p1",
      exchange: "dc_a_github",
      expiresAt: Date.now() + 60_000,
    });
    assert.equal(
      readFlow(id, PROVIDER.gitlab),
      null,
      "GitHub's device_code does not come out for GitLab",
    );
    assert.equal(
      readFlow(id, PROVIDER.github)?.exchange,
      "dc_a_github",
      "the owner finds it intact",
    );
  });

  // G: a guessable id would protect nothing. `id.length >= 16` let `Date.now() + Math.random()`
  // through. What holds is no duplicates and no shared prefix across many opens; a counter or a clock
  // would produce both.
  it("flowIds are not guessable: no duplicate and no shared prefix across 500 opens", () => {
    const ids = Array.from({ length: 500 }, (_, i) =>
      openFlow({
        provider: PROVIDER.github,
        projectId: "p1",
        exchange: `dc_${i}`,
        expiresAt: Date.now() + 60_000,
      }),
    );
    assert.equal(new Set(ids).size, ids.length, "two opens must never return the same id");
    const prefixes = new Set(ids.map((id) => id.slice(0, 4)));
    assert.ok(
      prefixes.size > ids.length * 0.9,
      "ids sharing a long prefix would betray a counter or a clock, not randomness",
    );
  });

  // F: `readFlow` only purges what it is asked to read; a flow opened and never polled never passes
  // through it. `sweepExpired`, called by `openFlow`, keeps the map from growing with dead entries.
  it("sweeps a never-read expired flow on the next openFlow", () => {
    const before = flowCount();
    openFlow({
      provider: PROVIDER.github,
      projectId: "p1",
      exchange: "dc_abandoned",
      expiresAt: Date.now() - 1,
    });
    assert.equal(flowCount(), before + 1, "the expired flow is added: it does not sweep itself");

    openFlow({
      provider: PROVIDER.github,
      projectId: "p1",
      exchange: "dc_next",
      expiresAt: Date.now() + 60_000,
    });
    assert.equal(
      flowCount(),
      before + 1,
      "the never-read expired flow was swept on the next open; the new one takes its place",
    );
  });
});
