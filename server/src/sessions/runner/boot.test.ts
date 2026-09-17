// Boot is a security boundary: the nonce is the only access token to a spec that holds the auth
// token and the granted secrets. Every property assumed here must be checked, not hoped for.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropSpecs, stageSpec, stagedCount, takeSpec } from "./boot.js";

const SPEC = { sessionId: "s1", env: { ANTHROPIC_API_KEY: "sk-secret" } };

describe("stageSpec / takeSpec", () => {
  it("returns the staged spec for the right nonce", () => {
    const nonce = stageSpec("s1", SPEC);
    assert.deepEqual(takeSpec("s1", nonce), SPEC);
  });

  it("serves the spec only once", () => {
    const nonce = stageSpec("s1", SPEC);
    assert.deepEqual(takeSpec("s1", nonce), SPEC);
    assert.equal(takeSpec("s1", nonce), null, "a replayed nonce must be refused");
  });

  it("refuses an unknown nonce", () => {
    assert.equal(takeSpec("s1", "made-up-nonce"), null);
  });

  it("refuses a valid nonce presented on ANOTHER session", () => {
    const nonce = stageSpec("s1", SPEC);
    assert.equal(takeSpec("s2", nonce), null);
  });

  it("burns a nonce presented on the wrong session", () => {
    // Otherwise an attacker could probe session ids one by one and keep the nonce intact until
    // hitting the right one.
    const nonce = stageSpec("s1", SPEC);
    takeSpec("s2", nonce);
    assert.equal(takeSpec("s1", nonce), null, "the nonce must be dead after a wrong attempt");
  });

  it("produces a different, long nonce on every stage", () => {
    const a = stageSpec("s1", SPEC);
    const b = stageSpec("s1", SPEC);
    assert.notEqual(a, b);
    // 32 bytes in base64url ≈ 43 characters: not a guessable identifier.
    assert.ok(a.length >= 40, `nonce too short: ${a.length}`);
    takeSpec("s1", a);
    takeSpec("s1", b);
  });
});

describe("dropSpecs", () => {
  it("drops one session's pending specs without touching the others", () => {
    const mine = stageSpec("s1", SPEC);
    const other = stageSpec("s2", SPEC);
    dropSpecs("s1");
    assert.equal(takeSpec("s1", mine), null);
    assert.deepEqual(takeSpec("s2", other), SPEC);
  });

  it("leaves nothing behind in memory", () => {
    stageSpec("s9", SPEC);
    stageSpec("s9", SPEC);
    dropSpecs("s9");
    assert.equal(stagedCount(), 0);
  });
});
