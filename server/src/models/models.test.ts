// What matters is not "the list is right" (the SDK owns that) but "we never claim a capability a
// model lacks". Capability fields are optional in the SDK: reading `undefined` as `true` would show
// an effort setting that does nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EFFORT_LEVELS, effortAllowed, toChoice, type ModelChoice } from "./models.js";

describe("toChoice", () => {
  it("assumes NO capability when the SDK says nothing", () => {
    const c = toChoice({ value: "claude-x" });
    assert.equal(c.supportsEffort, false, "a missing field is not a yes");
    assert.deepEqual(c.effortLevels, []);
    assert.equal(c.supportsAdaptiveThinking, false);
  });

  it("keeps announced effort levels and drops unknown ones", () => {
    const c = toChoice({
      value: "m",
      supportsEffort: true,
      supportedEffortLevels: ["low", "max", "turbo"],
    });
    assert.deepEqual(c.effortLevels, ["low", "max"], '"turbo" is not an SDK level');
  });

  it("falls back to the full scale when the flag is true without a list", () => {
    const c = toChoice({ value: "m", supportsEffort: true });
    assert.deepEqual(c.effortLevels, [...EFFORT_LEVELS]);
  });

  it("levels without the flag count as yes: the list proves the capability", () => {
    const c = toChoice({ value: "m", supportedEffortLevels: ["high"] });
    assert.equal(c.supportsEffort, true);
    assert.deepEqual(c.effortLevels, ["high"]);
  });

  it("exposes the real id behind an alias, and nothing when it is the same", () => {
    assert.equal(
      toChoice({ value: "sonnet", resolvedModel: "claude-sonnet-5" }).resolves,
      "claude-sonnet-5",
    );
    assert.equal(
      toChoice({ value: "claude-sonnet-5", resolvedModel: "claude-sonnet-5" }).resolves,
      null,
    );
  });

  it("falls back to the id when there is no readable name", () => {
    assert.equal(toChoice({ value: "claude-x", displayName: "   " }).displayName, "claude-x");
  });
});

const MODELS: ModelChoice[] = [
  {
    id: "opus",
    resolves: "claude-opus-5",
    displayName: "Opus",
    description: "",
    supportsEffort: true,
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
  },
  {
    id: "haiku",
    resolves: null,
    displayName: "Haiku",
    description: "",
    supportsEffort: false,
    effortLevels: [],
    supportsAdaptiveThinking: false,
  },
];

describe("effortAllowed", () => {
  it("accepts a level the model announces", () => {
    assert.equal(effortAllowed(MODELS, "opus", "xhigh"), true);
  });

  it("rejects any effort on a model that does not support it", () => {
    assert.equal(effortAllowed(MODELS, "haiku", "low"), false);
  });

  it("rejects a level outside the announced ones", () => {
    assert.equal(effortAllowed(MODELS, "opus", "turbo"), false);
  });

  it("does NOT block a model unknown to the SDK: a hand-pinned id stays legitimate", () => {
    // Otherwise pinning a dated version the SDK does not list yet would make the agent unsaveable.
    assert.equal(effortAllowed(MODELS, "claude-opus-5-20260601", "high"), true);
  });
});
