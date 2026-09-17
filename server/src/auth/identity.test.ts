import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAuthIdentity, type AuthIdentity } from "./identity.js";

describe("resolveAuthIdentity", () => {
  describe("kind resolution", () => {
    it("recognises an API key alone", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-abc123def456ghi",
      });
      assert.equal(result.kind, "api-key");
    });

    it("recognises an OAuth token alone", () => {
      const result = resolveAuthIdentity({
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-abc123def456ghi",
      });
      assert.equal(result.kind, "oauth");
    });

    it("recognises no credential at all", () => {
      const result = resolveAuthIdentity({});
      assert.equal(result.kind, "none");
    });

    it("prefers API_KEY when both are present", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-api-abc123",
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-xyz789",
      });
      assert.equal(result.kind, "api-key");
    });

    it("ignores empty values", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
      });
      assert.equal(result.kind, "none");
    });
  });

  describe("masking", () => {
    it("masks the API key as first 11 chars + length", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-v1-abcdefghijklmnop",
      });
      assert.equal(result.masked, "sk-ant-v1-a… (26 chars)");
    });

    it("masks the OAuth token the same way", () => {
      const result = resolveAuthIdentity({
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-abcdefghijklmnop",
      });
      assert.equal(result.masked, "sk-ant-oat-… (27 chars)");
    });

    it("returns null masked when kind is none", () => {
      const result = resolveAuthIdentity({});
      assert.equal(result.masked, null);
    });

    it("masks a value of exactly 11 chars", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-1234",
      });
      assert.equal(result.masked, "sk-ant-1234… (11 chars)");
    });

    it("masks a value shorter than 11 chars", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-abc",
      });
      assert.equal(result.masked, "sk-ant-abc… (10 chars)");
    });

    it("never contains more than the first 11 chars of the secret", () => {
      const secret = "sk-ant-super-secret-token-12345-abcdef";
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: secret,
      });
      const serialized = JSON.stringify(result);
      const first11 = secret.slice(0, 11);
      const rest = secret.slice(11);
      assert.ok(serialized.includes(first11), "must contain the first 11 chars");
      assert.ok(!serialized.includes(rest), "must not contain the rest of the secret");
    });
  });

  describe("warnings", () => {
    it("warns when an OAuth token is in ANTHROPIC_API_KEY", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-oat-abc123def456ghi",
      });
      const oauthInApiKey = result.warnings.find((w) => w.type === "oauth-in-api-key");
      assert.ok(oauthInApiKey, "must detect a misplaced OAuth token");
      assert.ok(oauthInApiKey!.message.includes("ANTHROPIC_API_KEY carries an OAuth token"));
    });

    it("warns when the OAuth token does not look like one", () => {
      const result = resolveAuthIdentity({
        CLAUDE_CODE_OAUTH_TOKEN: "not-an-oauth-token",
      });
      const malformed = result.warnings.find((w) => w.type === "oauth-malformed");
      assert.ok(malformed, "must detect a malformed OAuth token");
      assert.ok(malformed!.message.includes("does not look like an OAuth token"));
    });

    it("emits both warnings when OAuth is both misplaced and malformed", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-oat-wrongly-placed-oauth",
        CLAUDE_CODE_OAUTH_TOKEN: "not-an-oauth-token",
      });
      assert.equal(result.warnings.length, 2, "must emit both warnings");
      const types = result.warnings.map((w) => w.type);
      assert.ok(types.includes("oauth-in-api-key"));
      assert.ok(types.includes("oauth-malformed"));
    });

    it("emits no warning when tokens are well formed and well placed", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-api-abc123def456",
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-abc123def456",
      });
      assert.equal(result.warnings.length, 0);
    });

    it("does not warn on a well-formed OAuth token in its place", () => {
      const result = resolveAuthIdentity({
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-properly-formed-oauth",
      });
      const malformed = result.warnings.find((w) => w.type === "oauth-malformed");
      assert.ok(!malformed, "must not warn on a well-formed OAuth token");
    });

    it("does not warn on a well-formed API_KEY", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-api-well-formed",
      });
      const oauthInApiKey = result.warnings.find((w) => w.type === "oauth-in-api-key");
      assert.ok(!oauthInApiKey, "must not warn when an API key is well placed");
    });
  });

  describe("edge cases", () => {
    it("counts inner spaces in the length", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-v1 with spaces",
      });
      assert.equal(result.masked, "sk-ant-v1 w… (21 chars)");
    });

    it("returns kind, masked and warnings when no credential is present", () => {
      const result: AuthIdentity = resolveAuthIdentity({});
      assert.deepEqual(result, {
        kind: "none",
        masked: null,
        warnings: [],
      });
    });

    it("API_KEY wins even over a well-formed OAuth token", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-api-short",
        CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-well-formed-and-long",
      });
      assert.equal(result.kind, "api-key");
      assert.ok(result.masked!.includes("sk-ant-api"));
    });
  });

  describe("serialization safety", () => {
    it("JSON.stringify never reveals the full secret", () => {
      const longSecret = "sk-ant-very-secret-token-" + "a".repeat(100);
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: longSecret,
      });
      const json = JSON.stringify(result);
      assert.ok(json.includes(longSecret.slice(0, 11)));
      assert.ok(!json.includes(longSecret.slice(11)));
    });

    it("the masked format is always 11 chars + ellipsis + (N chars)", () => {
      const result = resolveAuthIdentity({
        ANTHROPIC_API_KEY: "sk-ant-test",
      });
      assert.match(result.masked!, /^.{11}… \(\d+ chars\)$/);
    });
  });
});
