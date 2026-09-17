// What `auth.ts` keeps for itself: masking the losing credentials for an SDK control call.
// Resolution is tested in `credential-resolution.test.ts` (it moved there in v64).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { soleCredentialEnv } from "./auth.js";

const OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";
const APIKEY = "ANTHROPIC_API_KEY";

describe("soleCredentialEnv", () => {
  it("keeps only the subscription token when both are present", () => {
    // The real case of 20/08: both in server/.env, and the SDK answered that the account had no
    // subscription limit because it saw the API key.
    const e = soleCredentialEnv({ [OAUTH]: "sk-ant-oat", [APIKEY]: "sk-api", PATH: "/usr/bin" });
    assert.equal(e[OAUTH], "sk-ant-oat");
    assert.equal(e[APIKEY], undefined, "the API key must be masked, not merely deprioritised");
    assert.equal(e.PATH, "/usr/bin", "the rest of the environment passes intact");
  });

  it("leaves the API key alone when it is all there is", () => {
    const e = soleCredentialEnv({ [APIKEY]: "sk-api" });
    assert.equal(e[APIKEY], "sk-api");
    assert.equal(e[OAUTH], undefined);
  });

  it("masks nothing when no credential is present", () => {
    // Masking without having chosen would decide for the operator.
    assert.deepEqual(soleCredentialEnv({ PATH: "/usr/bin" }), { PATH: "/usr/bin" });
  });

  it("sets undefined rather than removing the key: what the SDK's Options.env expects", () => {
    const e = soleCredentialEnv({ [OAUTH]: "t", [APIKEY]: "k" });
    assert.ok(APIKEY in e, "the key must exist in the object, with value undefined");
  });

  it("an empty secret does not count as a credential", () => {
    const e = soleCredentialEnv({ [OAUTH]: "", [APIKEY]: "sk-api" });
    assert.equal(e[APIKEY], "sk-api", "the empty token must not mask the working key");
  });
});
