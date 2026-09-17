// v24: complexity → model routing moved from a hard-coded table (BY_COMPLEXITY) to the per-project
// `project.modelRouting`. Locks: each level, a missing/empty entry falling back to the default, a
// `null` routing (project older than v24), and the unchanged priority (task override → agent model
// → complexity → project default).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseModelRouting, resolveModel, validateModelRoutingInput } from "./model.js";

const project = (modelRouting: string | null | undefined) => ({
  defaultModel: "sonnet",
  modelRouting,
});
const agent = (model: string | null = null) => ({ model });
const task = (complexity?: "low" | "med" | "high", modelOverride: string | null = null) => ({
  modelOverride,
  complexity,
});

describe("parseModelRouting", () => {
  it("reads every level that is set", () => {
    assert.deepEqual(parseModelRouting('{"low":"haiku","med":"sonnet","high":"opus"}'), {
      low: "haiku",
      med: "sonnet",
      high: "opus",
    });
  });

  it("ignores a key outside {low,med,high}", () => {
    assert.deepEqual(parseModelRouting('{"low":"haiku","urgent":"opus"}'), { low: "haiku" });
  });

  it("ignores an empty or non-string value", () => {
    assert.deepEqual(parseModelRouting('{"low":"","high":42}'), {});
  });

  it("falls back to {} for null/undefined/invalid JSON/non-object", () => {
    assert.deepEqual(parseModelRouting(null), {});
    assert.deepEqual(parseModelRouting(undefined), {});
    assert.deepEqual(parseModelRouting("{not json"), {});
    assert.deepEqual(parseModelRouting("[1,2,3]"), {});
  });
});

describe("resolveModel: priority", () => {
  it("a task override wins over everything, even an agent model", () => {
    assert.equal(
      resolveModel(
        task("high", "claude-sonnet-4-5-pinned"),
        agent("opus"),
        project('{"high":"opus"}'),
      ),
      "claude-sonnet-4-5-pinned",
    );
  });

  it("the agent model wins over complexity", () => {
    assert.equal(resolveModel(task("high"), agent("sonnet"), project('{"high":"opus"}')), "sonnet");
  });

  it("each complexity level routes to the project's entry", () => {
    const p = project('{"low":"haiku","med":"sonnet","high":"opus"}');
    assert.equal(resolveModel(task("low"), agent(), p), "haiku");
    assert.equal(resolveModel(task("med"), agent(), p), "sonnet");
    assert.equal(resolveModel(task("high"), agent(), p), "opus");
  });

  it("a task without complexity gets the project default", () => {
    assert.equal(resolveModel(task(undefined), agent(), project('{"low":"haiku"}')), "sonnet");
  });
});

describe("resolveModel: missing or empty entry", () => {
  it("a missing entry for the level falls back to the project default", () => {
    assert.equal(
      resolveModel(task("med"), agent(), project('{"low":"haiku","high":"opus"}')),
      "sonnet",
    );
  });

  it("an empty string entry for the level falls back to the project default", () => {
    assert.equal(resolveModel(task("high"), agent(), project('{"high":""}')), "sonnet");
  });

  it("a null routing (project older than v24) falls back to the project default", () => {
    assert.equal(resolveModel(task("high"), agent(), project(null)), "sonnet");
    assert.equal(resolveModel(task("low"), agent(), project(undefined)), "sonnet");
  });

  it("a dated id pinned on a level comes out as is", () => {
    assert.equal(
      resolveModel(task("high"), agent(), project('{"high":"claude-opus-4-5-20260815"}')),
      "claude-opus-4-5-20260815",
    );
  });
});

describe("validateModelRoutingInput", () => {
  it("accepts an object with valid keys and non-empty strings", () => {
    assert.deepEqual(validateModelRoutingInput({ low: "haiku", high: "opus" }), {
      ok: true,
      value: { low: "haiku", high: "opus" },
    });
  });

  it("accepts an id unknown to /api/models (pinned by hand)", () => {
    assert.deepEqual(validateModelRoutingInput({ high: "claude-opus-4-5-20260815" }), {
      ok: true,
      value: { high: "claude-opus-4-5-20260815" },
    });
  });

  it("trims values", () => {
    assert.deepEqual(validateModelRoutingInput({ low: "  haiku  " }), {
      ok: true,
      value: { low: "haiku" },
    });
  });

  it("null for a key clears it (back to the project default)", () => {
    assert.deepEqual(validateModelRoutingInput({ low: null }), { ok: true, value: {} });
  });

  it("null as a whole resets everything to the project default", () => {
    assert.deepEqual(validateModelRoutingInput(null), { ok: true, value: {} });
  });

  it("rejects a key outside {low,med,high}", () => {
    const r = validateModelRoutingInput({ urgent: "opus" });
    assert.equal(r.ok, false);
  });

  it("rejects an empty or non-string value", () => {
    assert.equal(validateModelRoutingInput({ low: "" }).ok, false);
    assert.equal(validateModelRoutingInput({ low: "   " }).ok, false);
    assert.equal(validateModelRoutingInput({ low: 42 }).ok, false);
  });

  it("rejects an array or a scalar", () => {
    assert.equal(validateModelRoutingInput(["haiku"]).ok, false);
    assert.equal(validateModelRoutingInput("haiku").ok, false);
  });
});
