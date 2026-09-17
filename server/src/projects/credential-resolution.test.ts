// Credential resolution decides whether a session runs for real or in mock, which account it
// spends, and since v64 whether it can restart now or must sleep. Rules that look trivial are
// checked too: "the project wins alone" avoids depending on the SDK's read order, and "a past
// reopening time says nothing" avoids burying a live account.
//
// No database, no real environment: everything comes in through parameters.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCredential } from "./credential-resolution.js";
import type { RankedCredential } from "./credential-resolution.js";

const OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";
const APIKEY = "ANTHROPIC_API_KEY";
const NOW = Date.parse("2026-09-08T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const token = (
  id: string,
  rank: number,
  value = `sk-ant-oat-${id}`,
  label: string | null = id,
): RankedCredential => ({
  id,
  name: OAUTH,
  rank,
  label,
  value,
  exhaustedUntil: null,
  exhaustedWindow: null,
});

/** The same token, closed until `NOW + inMs`. A negative `inMs` is a time already past: the column
 *  keeps its value, it simply stops being read. */
const closed = (c: RankedCredential, window: string, inMs: number): RankedCredential => ({
  ...c,
  exhaustedUntil: new Date(NOW + inMs),
  exhaustedWindow: window,
});

describe("resolveCredential: the three sources", () => {
  it("takes the project secret over the environment", () => {
    const r = resolveCredential({
      secrets: [{ name: OAUTH, value: "sk-ant-oat-project" }],
      env: { [OAUTH]: "sk-ant-oat-global" },
    });
    assert.deepEqual(r.env, { [OAUTH]: "sk-ant-oat-project" });
    assert.equal(r.from, "project");
  });

  it("takes the ordered list over the project secrets", () => {
    const r = resolveCredential({
      credentials: [token("c1", 1, "sk-ranked")],
      secrets: [{ name: APIKEY, value: "sk-api" }],
      env: { [OAUTH]: "sk-global" },
    });
    assert.deepEqual(r.env, { [OAUTH]: "sk-ranked" });
    assert.equal(r.credentialId, "c1");
  });

  it("falls back to the environment when the project has nothing", () => {
    const r = resolveCredential({ env: { [OAUTH]: "sk-ant-oat-global" } });
    assert.deepEqual(r.env, { [OAUTH]: "sk-ant-oat-global" });
    assert.equal(r.from, "control-plane");
    assert.equal(r.credentialId, null, "the control plane is not schedulable: nothing to exhaust");
  });

  it("prefers the subscription token to the API key within a project", () => {
    const r = resolveCredential({
      secrets: [
        { name: APIKEY, value: "sk-api" },
        { name: OAUTH, value: "sk-ant-oat" },
      ],
    });
    assert.deepEqual(r.env, { [OAUTH]: "sk-ant-oat" }, "the token must win, alone");
  });

  it("never mixes a project secret with a global variable", () => {
    // Otherwise the SDK receives two credentials and its read order decides which account pays.
    const r = resolveCredential({
      secrets: [{ name: OAUTH, value: "sk-ant-oat-project" }],
      env: { [APIKEY]: "sk-api-global" },
    });
    assert.deepEqual(r.env, { [OAUTH]: "sk-ant-oat-project" });
  });

  it("passes the environment through as is on fallback, even with both", () => {
    // Historical behaviour, kept so a working setup does not break.
    const r = resolveCredential({ env: { [OAUTH]: "a", [APIKEY]: "b" } });
    assert.deepEqual(r.env, { [OAUTH]: "a", [APIKEY]: "b" });
    assert.equal(r.credentialName, OAUTH, "the token is what serves, and what is named");
  });

  it("ignores an empty secret and falls back to the environment", () => {
    const r = resolveCredential({
      secrets: [{ name: OAUTH, value: "" }],
      env: { [APIKEY]: "sk-api" },
    });
    assert.deepEqual(r.env, { [APIKEY]: "sk-api" });
  });

  it("ignores an empty ranked credential: the next rank serves", () => {
    const r = resolveCredential({ credentials: [token("c1", 1, ""), token("c2", 2)] });
    assert.equal(r.credentialId, "c2");
  });

  it("ignores a project secret that is not an auth credential", () => {
    const r = resolveCredential({ secrets: [{ name: "GITHUB_TOKEN", value: "ghp_xxx" }] });
    assert.deepEqual(r.env, {}, "a business secret must not serve as authentication");
    assert.equal(r.from, "none");
  });

  it("returns an empty object when there is nothing anywhere: the definition of mock", () => {
    const r = resolveCredential();
    assert.deepEqual(r.env, {});
    assert.equal(r.from, "none");
  });
});

describe("resolveCredential: rank", () => {
  it("the first rank wins, alone, whatever the list order", () => {
    const r = resolveCredential({
      credentials: [token("c3", 3), token("c1", 1), token("c2", 2)],
      now: NOW,
    });
    assert.equal(r.credentialId, "c1");
    assert.deepEqual(Object.keys(r.env), [OAUTH], "never two credentials injected together");
    assert.equal(r.available, true);
    assert.equal(r.retryAt, null);
  });

  it("returns the account label: two subscriptions share a variable name", () => {
    const r = resolveCredential({
      credentials: [{ ...token("c1", 1), label: "Personal" }],
      now: NOW,
    });
    assert.equal(r.credentialLabel, "Personal");
    assert.equal(r.credentialName, OAUTH);
  });
});

describe("resolveCredential: exhaustion", () => {
  it("skips an exhausted rank and takes the next", () => {
    const r = resolveCredential({
      credentials: [closed(token("c1", 1), "five_hour", 3 * HOUR), token("c2", 2)],
      now: NOW,
    });
    assert.equal(r.credentialId, "c2");
    assert.equal(r.available, true);
  });

  it("a past reopening time puts rank 1 back in place, without a purge", () => {
    // The column keeps its value; only the comparison with the current time decides. Without it
    // a token burnt on a Tuesday at 2 pm would be dead forever.
    const r = resolveCredential({
      credentials: [closed(token("c1", 1), "five_hour", -MINUTE), token("c2", 2)],
      now: NOW,
    });
    assert.equal(r.credentialId, "c1", "rank 1 is back as soon as its time has passed");
  });

  it("a weekly window overrides a reopened 5 h one: the latest known time counts", () => {
    // One time per account is enough: exhaustion is only discovered by using the account, so the
    // window that just closed is necessarily the one that counts.
    const r = resolveCredential({
      credentials: [closed(token("c1", 1), "seven_day", 3 * 24 * HOUR), token("c2", 2)],
      now: NOW,
    });
    assert.equal(r.credentialId, "c2");
  });

  it("one account's exhaustion says nothing about the others", () => {
    const r = resolveCredential({
      credentials: [token("c1", 1), closed(token("c2", 2), "seven_day", 24 * HOUR)],
      now: NOW,
    });
    assert.equal(r.credentialId, "c1");
    assert.equal(r.available, true);
  });
});

describe("resolveCredential: all exhausted, sleep", () => {
  it("returns the one reopening first, and when", () => {
    const r = resolveCredential({
      credentials: [
        closed(token("c1", 1), "seven_day", 3 * 24 * HOUR),
        closed(token("c2", 2), "five_hour", 2 * HOUR),
        closed(token("c3", 3), "five_hour", 4 * HOUR),
      ],
      now: NOW,
    });
    assert.equal(r.available, false, "none is usable: the session must sleep");
    assert.equal(r.retryAt?.getTime(), NOW + 2 * HOUR, "the nearest reset among credentials");
    assert.equal(r.credentialId, "c2", "resumes on the first to reopen, not rank 1");
  });

  it("does not fall back to the project API key when all tokens are exhausted", () => {
    // Decision of 08/09: the list holds only subscriptions, so there is no unlimited last resort.
    // Switching to pay-per-use because a quota closed would be spending decided by an outage.
    const r = resolveCredential({
      credentials: [closed(token("c1", 1), "five_hour", HOUR)],
      secrets: [{ name: APIKEY, value: "sk-api" }],
      env: { [OAUTH]: "sk-global" },
      now: NOW,
    });
    assert.equal(r.available, false);
    assert.deepEqual(
      r.env,
      { [OAUTH]: "sk-ant-oat-c1" },
      "neither the project API key nor the environment takes over",
    );
  });

  it("a single exhausted credential: sleep until its reset", () => {
    const r = resolveCredential({
      credentials: [closed(token("c1", 1), "seven_day_opus", 5 * HOUR)],
      now: NOW,
    });
    assert.equal(r.available, false);
    assert.equal(r.retryAt?.getTime(), NOW + 5 * HOUR);
  });
});
