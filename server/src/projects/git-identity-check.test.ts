// Checks the distinction between the three verdicts, not HTTP. The first test is the case that
// motivated the module: well-formed, configured, linked to nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { judgeGitIdentity } from "./git-identity-check.js";
import { DEFAULT_GIT_AUTHOR_EMAIL } from "./git-identity.js";

const verified = (...emails: string[]) => emails.map((email, i) => ({ email, primary: i === 0 }));

describe("judgeGitIdentity", () => {
  it("the PR #573 case: configured and valid address, absent from the account", () => {
    const v = judgeGitIdentity({
      email: "agents@acme.test",
      login: "operator",
      verifiedEmails: verified("operator@acme.test"),
    });
    assert.equal(v.status, "unlinked");
    assert.match(v.reason!, /agents@acme\.test/);
    assert.match(v.reason!, /operator/);
    assert.equal(v.suggestion, "operator@acme.test");
  });

  it("a verified account address is attributed, with no suggestion", () => {
    const v = judgeGitIdentity({
      email: "operator@acme.test",
      login: "operator",
      verifiedEmails: verified("operator@acme.test", "other@example.com"),
    });
    assert.equal(v.status, "attributed");
    assert.equal(v.reason, null);
    assert.equal(v.suggestion, null);
  });

  it("case makes no difference", () => {
    const v = judgeGitIdentity({
      email: "Operator@Acme.test",
      login: "operator",
      verifiedEmails: verified("operator@acme.test"),
    });
    assert.equal(v.status, "attributed");
  });

  it("the default is judged unlinked without querying the forge", () => {
    const v = judgeGitIdentity({
      email: DEFAULT_GIT_AUTHOR_EMAIL,
      login: null,
      verifiedEmails: null,
    });
    assert.equal(v.status, "unlinked");
    assert.match(v.reason!, new RegExp(DEFAULT_GIT_AUTHOR_EMAIL));
  });

  it("an empty address counts as the default", () => {
    assert.equal(
      judgeGitIdentity({ email: "   ", login: null, verifiedEmails: null }).status,
      "unlinked",
    );
  });

  it("silent forge: unknown, never unlinked", () => {
    const v = judgeGitIdentity({
      email: "operator@acme.test",
      login: "operator",
      verifiedEmails: null,
    });
    assert.equal(v.status, "unknown");
    assert.match(v.reason!, /verified addresses/);
    // Nothing to suggest when no safe address is known.
    assert.equal(v.suggestion, null);
  });

  it("empty list is not a silent forge: no verified address, so unlinked", () => {
    const v = judgeGitIdentity({
      email: "operator@acme.test",
      login: "operator",
      verifiedEmails: [],
    });
    assert.equal(v.status, "unlinked");
    assert.equal(v.suggestion, null);
  });

  it("without a known login, the message stays readable", () => {
    const v = judgeGitIdentity({
      email: "bot@example.com",
      login: null,
      verifiedEmails: verified("me@example.com"),
    });
    assert.equal(v.status, "unlinked");
    assert.match(v.reason!, /owns the token/);
  });

  it("the suggestion is the account's primary address, not the first one listed", () => {
    const v = judgeGitIdentity({
      email: "bot@example.com",
      login: "operator",
      verifiedEmails: [
        { email: "secondary@example.com", primary: false },
        { email: "primary@example.com", primary: true },
      ],
    });
    assert.equal(v.suggestion, "primary@example.com");
  });
});
