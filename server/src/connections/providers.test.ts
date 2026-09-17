// The `state` convention and the registry: the only two things this port decides; the rest is shape
// the compiler already holds.
//
// Why this file exists (15/09): `mintState` and `splitState` carry the only guard of an
// unauthenticated request that writes a secret. They were only exercised indirectly through the
// callback tests, and the round separating "look up by secret" from "check the prefix" found an
// ownership check that could never fail.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  knownProviders,
  PROVIDERS,
  mintState,
  providerFor,
  PROVIDER,
  registerProvider,
  splitState,
  TOKEN_ORIGIN,
  TOKEN_ORIGINS,
  type ConnectionProvider,
} from "./providers.js";

describe("the `state` of a redirect flow", () => {
  it("designates its provider and carries an unpredictable secret", () => {
    const state = mintState(PROVIDER.linear);
    const { kind, secret } = splitState(state);

    assert.equal(kind, PROVIDER.linear);
    // 16 bytes in base64url are 22 characters. `Math.random` is not cryptographic, and this token is
    // the only gate of an unauthenticated request that writes a secret.
    assert.ok(secret.length >= 22, `secret too short: ${secret.length}`);
    assert.notEqual(mintState(PROVIDER.linear), state, "two flows do not share their state");
  });

  it("splits at the first dot: the secret keeps its own", () => {
    // base64url produces none, but the convention must hold without depending on that alphabet.
    assert.deepEqual(splitState("linear.aa.bb"), { kind: "linear", secret: "aa.bb" });
  });

  it("returns an empty provider for a state without a dot, rather than guessing", () => {
    // A forged `state` has no reason to follow our convention. With no readable prefix,
    // `providerFor("")` finds nothing and the callback refuses; it must never fall back to a default
    // provider.
    assert.deepEqual(splitState("just-a-secret"), { kind: "", secret: "just-a-secret" });
    assert.equal(providerFor(""), undefined);
  });
});

describe("the provider registry", () => {
  it("returns a provider by kind, and nothing for an unknown kind", () => {
    const fake = {
      kind: "test-registry" as ConnectionProvider["kind"],
      secretName: "REGISTRY_TOKEN_TEST_ONLY",
      scopes: [],
      unconfigured: () => null,
      revokeUrl: () => "https://example.test/settings/applications",
      begin: async () => {
        throw new Error("not exercised");
      },
      complete: async () => {
        throw new Error("not exercised");
      },
    } satisfies ConnectionProvider;
    registerProvider(fake);

    assert.equal(providerFor("test-registry"), fake);
    assert.equal(providerFor("bitbucket"), undefined);
    assert.ok(knownProviders().includes(fake));
  });
});

describe("a token's origin", () => {
  it("serialises what the database and the UI read, nothing else", () => {
    // Key is the concept, value the serialisation: these strings travel into `secrets.metadata` and
    // the UI. Renaming them would break rows already written.
    assert.deepEqual([...TOKEN_ORIGINS], ["granted", "pasted"]);
    assert.equal(TOKEN_ORIGIN.granted, "granted");
    assert.equal(TOKEN_ORIGIN.pasted, "pasted");
  });
});

// Tile order must not depend on import order (round 4, 16/09). A `Map` returns insertion order, so
// module load order: an import added in `integrations/forge-access.ts` for a constant registered
// GitLab before GitHub, and the Connections screen went from "GitHub, GitLab, Linear" to "GitLab,
// GitHub, Linear", silently.
//
// This test imports the three adapters in reverse on purpose: if `knownProviders` returned registry
// order it would return these lines' order, so it fails at the first regression.
describe("knownProviders: order is written, not inherited from imports", () => {
  it("returns providers in PROVIDERS order, whatever the registration order", async () => {
    await import("./linear-redirect.js");
    await import("./gitlab-device.js");
    await import("./github-device.js");

    const ordre = knownProviders()
      .map((p) => p.kind)
      .filter((kind) => (PROVIDERS as readonly string[]).includes(kind));
    assert.deepEqual(ordre, [...PROVIDERS]);
  });
});
