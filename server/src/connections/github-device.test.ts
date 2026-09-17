// GitHub device flow without network: `fetch` is replaced, and what is checked is the translation of
// GitHub's answers into the domain. The four responses that matter are 200s with an `error` field:
// `authorization_pending` is normal, `slow_down` asks to space polling, `expired_token` and
// `access_denied` end the flow. Mistaking them for a network failure would abandon a flow about to
// succeed.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

process.env.LEGION_GITHUB_CLIENT_ID = "Iv1.test";

const { githubDevice } = await import("./github-device.js");
const { ARRIVED_KIND, FLOW_KIND, FLOW_STATUS, ProviderRefusal } = await import("./providers.js");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces `fetch` with a fixed JSON response and records URL, `content-type` and body. The body is
 *  read as form parameters, not `JSON.parse`: GitHub documents form-urlencoded on both endpoints, and a
 *  double parsing JSON would accept anything without revealing a wrongly encoded request. */
function stubFetch(payload: unknown): {
  calls: { url: string; body: unknown; contentType: string | null }[];
} {
  const calls: { url: string; body: unknown; contentType: string | null }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))),
      contentType: new Headers(init?.headers).get("content-type"),
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

describe("GitHub device flow: start", () => {
  it("requests a code form-urlencoded and returns the device variant", async () => {
    const { calls } = stubFetch({
      device_code: "dc_abc",
      user_code: "WXYZ-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });

    const begun = await githubDevice.begin({ projectId: "p1", field: undefined });

    assert.equal(calls[0]!.url, "https://github.com/login/device/code");
    assert.equal(calls[0]!.contentType, "application/x-www-form-urlencoded");
    assert.deepEqual(calls[0]!.body, { client_id: "Iv1.test", scope: "repo read:org user:email" });
    // A `throw` rather than an `assert`: it narrows the union for the following lines, where
    // `assert.equal` would leave the compiler thinking `userCode` may not exist.
    if (begun.kind !== FLOW_KIND.device) throw new Error("a device grant returns no redirect");
    assert.equal(begun.userCode, "WXYZ-1234");
    assert.equal(begun.verificationUri, "https://github.com/login/device");
    assert.equal(begun.intervalMs, 5000);
    assert.equal(begun.exchange, "dc_abc", "the device_code stays on the server");
  });

  // D: `Number("")` is zero and `??` only catches `undefined`. An `interval: ""` would hammer GitHub,
  // an `expires_in: ""` would close the flow as it opens. A remote server can return these; fall back
  // to the RFC defaults rather than zero.
  it("D: an empty string counts as missing, not zero", async () => {
    const before = Date.now();
    stubFetch({
      device_code: "dc_abc",
      user_code: "WXYZ-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: "",
      interval: "",
    });
    const begun = await githubDevice.begin({ projectId: "p1", field: undefined });
    if (begun.kind !== FLOW_KIND.device) throw new Error("a device grant returns no redirect");
    assert.equal(begun.intervalMs, 5000, "never 0: the UI would hammer the provider");
    assert.ok(begun.expiresAt >= before + 900_000, "never now: the flow would die as it opens");
  });

  it("URL scopes derive from `scopes`: one truth, not two to sync", async () => {
    const { calls } = stubFetch({
      device_code: "dc_abc",
      user_code: "WXYZ-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    await githubDevice.begin({ projectId: "p1", field: undefined });
    assert.equal(
      (calls[0]!.body as Record<string, string>).scope,
      githubDevice.scopes.join(" "),
      "the string sent to GitHub is exactly what the route will write to metadata",
    );
  });
});

describe("GitHub device flow: polling", () => {
  it("translates authorization_pending to pending", async () => {
    stubFetch({ error: "authorization_pending" });
    assert.deepEqual(
      await githubDevice.complete("dc_abc", { kind: ARRIVED_KIND.poll }, undefined),
      {
        status: FLOW_STATUS.pending,
      },
    );
  });

  it("translates slow_down to slow_down", async () => {
    stubFetch({ error: "slow_down" });
    assert.deepEqual(
      await githubDevice.complete("dc_abc", { kind: ARRIVED_KIND.poll }, undefined),
      {
        status: FLOW_STATUS.slowDown,
      },
    );
  });

  it("translates expired_token to expired", async () => {
    stubFetch({ error: "expired_token" });
    assert.deepEqual(
      await githubDevice.complete("dc_abc", { kind: ARRIVED_KIND.poll }, undefined),
      {
        status: FLOW_STATUS.expired,
      },
    );
  });

  it("translates access_denied to denied", async () => {
    stubFetch({ error: "access_denied" });
    assert.deepEqual(
      await githubDevice.complete("dc_abc", { kind: ARRIVED_KIND.poll }, undefined),
      {
        status: FLOW_STATUS.denied,
      },
    );
  });

  it("returns the token when GitHub said yes", async () => {
    stubFetch({ access_token: "ghp_new", token_type: "bearer", scope: "repo" });
    assert.deepEqual(
      await githubDevice.complete("dc_abc", { kind: ARRIVED_KIND.poll }, undefined),
      {
        status: FLOW_STATUS.connected,
        accessToken: "ghp_new",
      },
    );
  });

  it("names the refusal when device flow is not enabled on the app, and throws it as terminal", async () => {
    stubFetch({ error: "device_flow_disabled" });
    await assert.rejects(
      () => githubDevice.complete("dc_abc", { kind: ARRIVED_KIND.poll }, undefined),
      (err: unknown) =>
        err instanceof ProviderRefusal && /device flow/i.test((err as Error).message),
      "routes.ts tells a terminal refusal from a transport incident by the error type",
    );
  });

  // The other family. RFC 8628 has no redirect, so nothing can return through a callback with a
  // `code` for this flow. The adapter refuses by name rather than silently accepting: the half of the
  // port proving the union is not decorative.
  it("refuses an authorisation code, which a device grant never receives", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("a device grant must call nothing for an authorisation code");
    }) as typeof fetch;
    await assert.rejects(
      () =>
        githubDevice.complete(
          "dc_abc",
          { kind: ARRIVED_KIND.code, code: "ac_from_elsewhere" },
          undefined,
        ),
      // B: the type matters as much as the message: `routes.ts` classifies every ordinary `Error` as
      // a transport incident, so a bare `Error` here would become an endless "pending".
      (err: unknown) =>
        err instanceof ProviderRefusal &&
        /receives no authorization code/i.test((err as Error).message),
    );
    assert.equal(called, false, "the refusal is decided here, not at GitHub");
  });
});

describe("GitHub device flow: undeclared app", () => {
  // Direct test of `unconfigured()`: it reads `process.env.LEGION_GITHUB_CLIENT_ID` on each call, so one
  // import suffices. Re-importing with a cache-busting parameter would replay `registerProvider` and
  // overwrite the "github" registry entry for every later test in the process.
  // Empty string rather than `delete` (15/09): since the app is registered `DEFAULT_CLIENT_ID` is not
  // empty, and `??` only falls back on `undefined`, so deleting the variable would prove nothing. The
  // empty string says "this instance deliberately has no app", the only state the route must name.
  beforeEach(() => {
    process.env.LEGION_GITHUB_CLIENT_ID = "";
  });

  afterEach(() => {
    process.env.LEGION_GITHUB_CLIENT_ID = "Iv1.test";
  });

  it("reports unconfigured when no client id is set", () => {
    assert.match(
      String(githubDevice.unconfigured(undefined)),
      /LEGION_GITHUB_CLIENT_ID required/,
      "the refusal is a sentence for the operator, not a boolean the route must translate",
    );
  });
});

// Adopting a pasted token, the second acquisition path: what GitHub says about the token, and above
// all what is not made up when it says nothing.
describe("GitHub: adopting a pasted token", () => {
  /** A GitHub API response with its headers, where a PAT's scopes live; `stubFetch` (JSON only, fixed
   *  200) is not enough here. */
  function stubUser(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): { calls: { url: string; authorization: string | null }[] } {
    const calls: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    }) as typeof fetch;
    return { calls };
  }

  it("reads observed scopes from the header and the account from the body", async () => {
    const { calls } = stubUser(200, { login: "octocat" }, { "x-oauth-scopes": "repo, read:org" });

    const adopted = await githubDevice.adopt!("ghp_pasted", undefined);

    assert.equal(calls[0]!.url, "https://api.github.com/user");
    assert.equal(calls[0]!.authorization, "Bearer ghp_pasted");
    assert.deepEqual(adopted, { scopes: ["repo", "read:org"], account: "octocat" });
  });

  it("a fine-grained PAT does not publish its scopes: say unknown, do not make them up", async () => {
    stubUser(200, { login: "octocat" });

    const adopted = await githubDevice.adopt!("github_pat_pasted", undefined);

    assert.equal(
      adopted!.scopes,
      null,
      "without the header scopes are unknown; an empty array would say the token can do nothing, which is false",
    );
    assert.equal(adopted!.account, "octocat", "the account is known: a legitimate state");
  });

  it("an empty header states a fact: this token has no scopes", async () => {
    stubUser(200, { login: "octocat" }, { "x-oauth-scopes": "" });

    assert.deepEqual((await githubDevice.adopt!("ghp_bare", undefined))!.scopes, []);
  });

  it("a refused token returns null: a refusal to show, not an exception", async () => {
    stubUser(401, { message: "Bad credentials" });

    assert.equal(await githubDevice.adopt!("ghp_dead", undefined), null);
  });

  it("a 5xx is not a refusal: it throws, and the route writes nothing", async () => {
    stubUser(503, { message: "unavailable" });

    await assert.rejects(
      () => githubDevice.adopt!("ghp_valid", undefined),
      (e: Error) => !(e instanceof ProviderRefusal) && !e.message.includes("ghp_valid"),
      "a transport incident is an ordinary Error, and the token never enters its message",
    );
  });
});

// An exceeded quota is not a refusal, and GitHub says it with 403, not only 429 (correction round 1,
// 15/09). Otherwise a valid token gets declared unknown and the operator looks for another.
describe("GitHub: adoption, quota exceeded", () => {
  function stubStatus(status: number, headers: Record<string, string>): void {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status,
        headers: { "content-type": "application/json", ...headers },
      })) as typeof fetch;
  }

  it("throws on a 403 carrying the primary limit, rather than concluding refusal", async () => {
    stubStatus(403, { "x-ratelimit-remaining": "0" });

    await assert.rejects(() => githubDevice.adopt!("ghp_valid", undefined));
  });

  it("also throws on a 403 carrying `retry-after`: the secondary limit", async () => {
    stubStatus(403, { "retry-after": "60" });

    await assert.rejects(() => githubDevice.adopt!("ghp_valid", undefined));
  });

  it("keeps a bare 403 as a refusal: the only one about the token", async () => {
    stubStatus(403, {});

    assert.equal(await githubDevice.adopt!("ghp_no_rights", undefined), null);
  });

  it("throws on a 429, quota stated by the status", async () => {
    stubStatus(429, { "retry-after": "60" });

    await assert.rejects(() => githubDevice.adopt!("ghp_valid", undefined));
  });
});
