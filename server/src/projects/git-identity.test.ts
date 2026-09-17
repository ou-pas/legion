// Locks the boundary between "address refused with a 400 on write" and "address accepted and passed
// to the container as is": the only place a malformed address must be caught (see git-identity.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GIT_AUTHOR_EMAIL,
  DEFAULT_GIT_AUTHOR_NAME,
  resolveGitAuthor,
  validateGitAuthorEmail,
  validateGitAuthorName,
} from "./git-identity.js";

describe("validateGitAuthorEmail", () => {
  it("accepts a normal address", () => {
    assert.equal(validateGitAuthorEmail("bot@example.com"), null);
  });

  it("refuses an empty address", () => {
    assert.match(validateGitAuthorEmail("")!, /cannot be empty/);
  });

  it("refuses an address without @", () => {
    assert.match(validateGitAuthorEmail("not-an-email")!, /shape of an email address/);
  });

  it("refuses an address without a dotted domain", () => {
    assert.match(validateGitAuthorEmail("bot@localhost")!, /shape of an email address/);
  });

  it("refuses a line break: it would break the git ident line", () => {
    assert.match(validateGitAuthorEmail("bot@example.com\nX-Injected: oops")!, /line break/);
  });
});

describe("validateGitAuthorName", () => {
  it("accepts a free name, unicode included", () => {
    assert.equal(validateGitAuthorName("Zoë Delivery"), null);
  });

  it("refuses an empty name", () => {
    assert.match(validateGitAuthorName("   ")!, /cannot be empty/);
  });

  it("refuses < >: it would break the git ident line", () => {
    assert.match(validateGitAuthorName("oops <injected>")!, /< >/);
  });
});

describe("resolveGitAuthor", () => {
  it("falls back to the default when the project configured nothing", () => {
    assert.deepEqual(resolveGitAuthor({ gitAuthorName: null, gitAuthorEmail: null }), {
      name: DEFAULT_GIT_AUTHOR_NAME,
      email: DEFAULT_GIT_AUTHOR_EMAIL,
    });
  });

  it("falls back to the default on blank strings", () => {
    assert.deepEqual(resolveGitAuthor({ gitAuthorName: "  ", gitAuthorEmail: "" }), {
      name: DEFAULT_GIT_AUTHOR_NAME,
      email: DEFAULT_GIT_AUTHOR_EMAIL,
    });
  });

  it("uses the project identity when set", () => {
    assert.deepEqual(
      resolveGitAuthor({
        gitAuthorName: "Zoë Delivery",
        gitAuthorEmail: "delivery-bot@example.com",
      }),
      { name: "Zoë Delivery", email: "delivery-bot@example.com" },
    );
  });
});
