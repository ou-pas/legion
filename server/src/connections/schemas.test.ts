// What is accepted from outside, and what is read back from the database. The second boundary is the
// less obvious: `secrets.metadata` is text written by a version of the code that may not be the one
// reading it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROVIDER, TOKEN_ORIGIN } from "./providers.js";
import {
  AdoptConnectionBody,
  credentialOrigin,
  readCredentialMetadata,
  StartConnectionBody,
} from "./schemas.js";

describe("an adoption body", () => {
  it("requires a non-empty project and token", () => {
    assert.equal(AdoptConnectionBody.safeParse({ projectId: "p1", token: "tok" }).success, true);
    assert.equal(AdoptConnectionBody.safeParse({ projectId: "p1", token: "" }).success, false);
    assert.equal(AdoptConnectionBody.safeParse({ projectId: "", token: "tok" }).success, false);
  });

  it("refuses an unknown key by name rather than silently dropping it", () => {
    const parsed = AdoptConnectionBody.safeParse({ projectId: "p1", token: "tok", scopes: ["x"] });

    assert.equal(parsed.success, false);
    // Silently dropping would close the hole too, but the UI would believe it was heard as sent.
    assert.match(JSON.stringify(parsed.error?.issues), /scopes/);
  });

  it("imposes no shape on the token itself", () => {
    // Each provider has its own and they change; a regex would someday refuse a valid token. The
    // probe decides.
    for (const token of ["ghp_x", "github_pat_x", "lin_api_x", "glpat-x", "x".repeat(300)])
      assert.equal(AdoptConnectionBody.safeParse({ projectId: "p1", token }).success, true);
  });

  it("stays distinct from a start body, which carries no secret", () => {
    assert.equal(StartConnectionBody.safeParse({ projectId: "p1", token: "tok" }).success, false);
  });
});

describe("the metadata column, read back", () => {
  it("tells missing from unreadable, throwing in neither case", () => {
    // Missing: nobody ever wrote anything. The only case allowing an inference.
    assert.equal(readCredentialMetadata(null), undefined);
    assert.equal(readCredentialMetadata(""), undefined);
    // Unreadable: something is there and cannot be read. No inference possible.
    assert.equal(readCredentialMetadata("{not json"), null);
    assert.equal(readCredentialMetadata('"a string"'), null);
  });

  // An unknown provider is not unreadable `metadata`; this test first asserted the opposite, encoding
  // the defect as the rule. `provider` was a `z.enum(PROVIDERS)`, so an out-of-enum value rejected
  // the whole object: the most strictly validated field was the one nobody reads, and it threw away
  // `account`, `scopes` and `origin`, which everyone reads.
  it("reads a row written by a provider it no longer knows", () => {
    const read = readCredentialMetadata(
      JSON.stringify({ provider: "bitbucket", account: "mona", scopes: ["repo"] }),
    );

    assert.notEqual(read, null, "an unknown provider does not make the whole row unreadable");
    assert.equal(read?.account, "mona");
    assert.deepEqual(read?.scopes, ["repo"]);
  });

  it("lets unknown fields through and types known ones", () => {
    // `.passthrough()` rather than `strictObject`: this column exists so other integrations can attach
    // what they need.
    const read = readCredentialMetadata(
      JSON.stringify({ provider: PROVIDER.github, scopes: ["repo"], host: "git.example.com" }),
    );

    assert.deepEqual(read?.scopes, ["repo"]);
    assert.equal((read as Record<string, unknown>).host, "git.example.com");
  });

  it("refuses a wrongly typed value rather than passing it on", () => {
    assert.equal(readCredentialMetadata(JSON.stringify({ scopes: "repo" })), null);
    assert.equal(readCredentialMetadata(JSON.stringify({ expiresAt: -1 })), null);
  });
});

describe("where a token comes from", () => {
  it("no metadata means pasted: the only fact available", () => {
    assert.equal(credentialOrigin(undefined), TOKEN_ORIGIN.pasted);
    assert.equal(credentialOrigin(readCredentialMetadata(null)), TOKEN_ORIGIN.pasted);
  });

  it("unreadable metadata does not read as pasted: unknown, and said so", () => {
    // A granted credential whose JSON no longer parsed showed "Pasted token: the provider does not
    // know Legion exists", a false sentence presented as fact.
    assert.equal(credentialOrigin(null), null);
    assert.equal(credentialOrigin(readCredentialMetadata("{not json")), null);
  });

  it("metadata without origin means granted: a bounded archaeological reading", () => {
    // Before 15/09 `storeToken` was the only writer of this column, so a row carrying one came from a
    // flow. Both sides write the field since.
    assert.equal(
      credentialOrigin(readCredentialMetadata(JSON.stringify({ provider: PROVIDER.github }))),
      TOKEN_ORIGIN.granted,
    );
  });

  it("a written origin is authoritative, and can say pasted despite filled metadata", () => {
    const pasted = readCredentialMetadata(
      JSON.stringify({ provider: PROVIDER.github, origin: TOKEN_ORIGIN.pasted, scopes: ["repo"] }),
    );

    assert.equal(credentialOrigin(pasted), TOKEN_ORIGIN.pasted);
  });
});
