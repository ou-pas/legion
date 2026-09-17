// Identity adoption, both ways: what it sets and above all what it refuses to set. Each of the
// three rules has its test, each verified by breaking the rule it guards.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityToAdopt, isIdentityAtDefault } from "./repo-adoption.js";
import { DEFAULT_GIT_AUTHOR_EMAIL, DEFAULT_GIT_AUTHOR_NAME } from "./git-identity.js";

const DEFAULT_IDENTITY = { name: null, email: null };

/** Addresses as GitHub returns them on the operator's account (probe of 15/09): the noreply is
 *  listed, `verified: true`, `primary: false`, next to the real address. */
const BOTH = [
  { email: "romuald@example.com", primary: true },
  { email: "46607170+ou-pas@users.noreply.github.com", primary: false },
];

describe("isIdentityAtDefault", () => {
  it("nothing set means default", () => {
    assert.equal(isIdentityAtDefault({ name: null, email: null }), true);
  });

  it("the default set explicitly is still the default", () => {
    assert.equal(
      isIdentityAtDefault({ name: DEFAULT_GIT_AUTHOR_NAME, email: DEFAULT_GIT_AUTHOR_EMAIL }),
      true,
    );
  });

  it("blanks are not a choice: still the default", () => {
    assert.equal(isIdentityAtDefault({ name: "  ", email: "  " }), true);
  });

  it("a name alone is already a choice, not undone", () => {
    assert.equal(isIdentityAtDefault({ name: "Acme Agent", email: null }), false);
  });

  it("an address alone is already a choice", () => {
    assert.equal(isIdentityAtDefault({ name: null, email: "agents@acme.test" }), false);
  });
});

describe("identityToAdopt", () => {
  it("prefers the noreply to the primary address (the push can never be refused)", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: null,
      verifiedEmails: BOTH,
    });
    assert.deepEqual(adopted, {
      name: "ou-pas",
      email: "46607170+ou-pas@users.noreply.github.com",
    });
  });

  it("without a noreply, falls back to the primary", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: "Romuald",
      verifiedEmails: [
        { email: "secondary@example.com", primary: false },
        { email: "romuald@example.com", primary: true },
      ],
    });
    assert.deepEqual(adopted, { name: "Romuald", email: "romuald@example.com" });
  });

  it("the name falls back to the login when the forge gives none (real case of 15/09)", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: null,
      verifiedEmails: [{ email: "romuald@example.com", primary: true }],
    });
    assert.equal(adopted?.name, "ou-pas");
  });

  it("an identity already chosen is never overwritten", () => {
    const adopted = identityToAdopt({
      current: { name: "Acme Agent", email: "agents@acme.test" },
      login: "ou-pas",
      name: "Romuald",
      verifiedEmails: BOTH,
    });
    assert.equal(adopted, null);
  });

  it("a silent forge (null) sets nothing: no address is made up", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: "Romuald",
      verifiedEmails: null,
    });
    assert.equal(adopted, null);
  });

  it("no verified address sets nothing either", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: "Romuald",
      verifiedEmails: [],
    });
    assert.equal(adopted, null);
  });

  it("neither name nor login: an identity that cannot be named is not set", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: null,
      name: null,
      verifiedEmails: BOTH,
    });
    assert.equal(adopted, null);
  });

  it("an enterprise noreply (users.noreply.<host>) is recognised as such", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: null,
      verifiedEmails: [
        { email: "romuald@acme.test", primary: true },
        { email: "42+ou-pas@users.noreply.github.acme.test", primary: false },
      ],
    });
    assert.equal(adopted?.email, "42+ou-pas@users.noreply.github.acme.test");
  });

  it("an address containing noreply outside its domain stays ordinary", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: null,
      verifiedEmails: [{ email: "noreply@example.com", primary: true }],
    });
    assert.equal(adopted?.email, "noreply@example.com");
  });
});

describe("what comes from the forge stays external data", () => {
  it("a name that would break the git ident line is not set", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: null,
      name: "Roro <boss>",
      verifiedEmails: BOTH,
    });
    assert.equal(adopted, null);
  });

  it("an address that is not one is not set either", () => {
    const adopted = identityToAdopt({
      current: DEFAULT_IDENTITY,
      login: "ou-pas",
      name: null,
      verifiedEmails: [{ email: "not-an-address", primary: true }],
    });
    assert.equal(adopted, null);
  });
});
