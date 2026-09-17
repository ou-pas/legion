// Linear through authorisation code + PKCE: what the adapter sends and what it keeps back.
//
// Not the route (that is `routes.test.ts`) but four protocol facts the whole connection depends on,
// none visible when reading: the `code_verifier` stays on the server, the `code_challenge` really is
// its SHA-256, scopes go comma-separated, and the redirect URL is the same going out and at exchange.
// Each breaks silently: the provider answers "invalid", far away, without saying which.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

process.env.LEGION_MASTER_KEY ??= "0".repeat(64);

const { linearRedirect } = await import("./linear-redirect.js");
const { ARRIVED_KIND, AUTH_FORMAT, FLOW_KIND, FLOW_STATUS, ProviderRefusal } =
  await import("./providers.js");

const PUBLIC_URL = "https://legion.example.test";
const CALLBACK = `${PUBLIC_URL}/api/connections/callback`;

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.LEGION_PUBLIC_URL = PUBLIC_URL;
  process.env.LEGION_LINEAR_CLIENT_ID = "lin_client_test";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.LEGION_PUBLIC_URL;
  delete process.env.LEGION_LINEAR_CLIENT_ID;
});

/** The form-urlencoded body of the last POST, decoded: the only way to see what really leaves. */
function captureTokenPost(response: Record<string, unknown>): () => Record<string, string> {
  let sent: Record<string, string> = {};
  globalThis.fetch = (async (_url: unknown, init: { body?: URLSearchParams }) => {
    sent = Object.fromEntries(new URLSearchParams(init.body).entries());
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return () => sent;
}

async function authorizeParams(): Promise<{ params: URLSearchParams; exchange: string }> {
  const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
  assert.equal(started.kind, FLOW_KIND.redirect);
  const url = new URL((started as { authorizeUrl: string }).authorizeUrl);
  return { params: url.searchParams, exchange: started.exchange };
}

describe("linear: the authorisation URL", () => {
  it("goes to Linear with the seven authorisation request parameters", async () => {
    const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
    const url = new URL((started as { authorizeUrl: string }).authorizeUrl);
    assert.equal(url.origin + url.pathname, "https://linear.app/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "lin_client_test");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("redirect_uri"), CALLBACK);
  });

  // The trap: GitHub and GitLab separate scopes with spaces, Linear with commas. Copying `join(" ")`
  // would have asked for one scope named "read write", which does not exist, with no error until the
  // first API call on a connection that looks connected.
  it("separates its scopes with commas, not spaces", async () => {
    const { params } = await authorizeParams();
    assert.equal(params.get("scope"), "read,write");
    assert.equal(
      params.get("scope")?.includes(" "),
      false,
      "a space here and Linear reads a single scope that does not exist",
    );
  });

  // `write` is not a convenience: `moveIssueInProgress` sends an `issueUpdate` when a task starts. A
  // read-only connection would fail there, in a fire-and-forget.
  it("asks to write, because Legion writes", async () => {
    assert.deepEqual([...linearRedirect.scopes], ["read", "write"]);
  });

  it("stores the token under the name the Linear integration already reads", () => {
    assert.equal(linearRedirect.secretName, "LINEAR_TOKEN");
  });
});

describe("linear: PKCE", () => {
  // The computation, not the code compared to itself. Recomputing the hash from the verifier is the
  // only proof it is SHA-256 in base64url: comparing `challenge` to the URL's would pass even if the
  // adapter sent the verifier in clear.
  it("code_challenge is the verifier's SHA-256 in base64url", async () => {
    const { params, exchange } = await authorizeParams();
    const { verifier } = JSON.parse(exchange) as { verifier: string };
    assert.equal(
      params.get("code_challenge"),
      createHash("sha256").update(verifier).digest("base64url"),
    );
  });

  it("the verifier has the length RFC 7636 requires", async () => {
    const { exchange } = await authorizeParams();
    const { verifier } = JSON.parse(exchange) as { verifier: string };
    assert.ok(verifier.length >= 43, `a ${verifier.length}-character verifier is too short`);
  });

  // PKCE's whole guarantee. If the verifier went into the consent URL, anyone intercepting the
  // returning `code` could exchange it, and the adapter would look correct.
  it("the verifier never goes into the authorisation URL", async () => {
    const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
    const authorizeUrl = (started as { authorizeUrl: string }).authorizeUrl;
    const { verifier } = JSON.parse(started.exchange) as { verifier: string };
    assert.equal(
      authorizeUrl.includes(verifier),
      false,
      "code_verifier in the consent URL voids PKCE",
    );
  });

  it("two flows share neither verifier nor state", async () => {
    const a = JSON.parse(
      (await linearRedirect.begin({ projectId: "p1", field: undefined })).exchange,
    ) as {
      verifier: string;
      state: string;
    };
    const b = JSON.parse(
      (await linearRedirect.begin({ projectId: "p1", field: undefined })).exchange,
    ) as {
      verifier: string;
      state: string;
    };
    assert.notEqual(a.verifier, b.verifier);
    assert.notEqual(a.state, b.state);
  });

  it("the state carries its provider and stays unpredictable", async () => {
    const { params } = await authorizeParams();
    const state = params.get("state") ?? "";
    assert.ok(state.startsWith("linear."), "the callback is unique: the state says whose it is");
    assert.ok(
      state.slice("linear.".length).length >= 20,
      "16 bytes in base64url: the same quality as a flowId",
    );
  });
});

describe("linear: code exchange", () => {
  it("posts the verifier, the code and the same redirect URL as going out", async () => {
    const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
    const { verifier } = JSON.parse(started.exchange) as { verifier: string };
    const sent = captureTokenPost({ access_token: "lin_oauth_abc", expires_in: 86399 });

    await linearRedirect.complete(
      started.exchange,
      { kind: ARRIVED_KIND.code, code: "the_code" },
      undefined,
    );

    const body = sent();
    assert.equal(body.code, "the_code");
    assert.equal(body.code_verifier, verifier);
    assert.equal(body.grant_type, "authorization_code");
    assert.equal(body.client_id, "lin_client_test");
    // Identical to the way out, or Linear refuses the exchange. The only check proving it: the two
    // values are produced at different moments by different calls.
    assert.equal(
      body.redirect_uri,
      new URL((started as { authorizeUrl: string }).authorizeUrl).searchParams.get("redirect_uri"),
    );
    // `client_secret` is optional at Linear once a verifier accompanies the exchange, which keeps
    // `client_id` public. Sending one would put a secret where the repository decided to have none.
    assert.equal("client_secret" in body, false);
  });

  it("returns the token, its refresh token and its expiry", async () => {
    const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
    captureTokenPost({
      access_token: "lin_oauth_abc",
      refresh_token: "lin_refresh_abc",
      expires_in: 86399,
      token_type: "Bearer",
    });
    const before = Date.now();
    const done = await linearRedirect.complete(
      started.exchange,
      {
        kind: ARRIVED_KIND.code,
        code: "c",
      },
      undefined,
    );
    assert.equal(done.status, FLOW_STATUS.connected);
    assert.equal(done.accessToken, "lin_oauth_abc");
    // The first provider whose token dies: twenty-four hours, so a `refresh_token` and an expiry that
    // must both reach `putSecret`.
    assert.equal(done.refreshToken, "lin_refresh_abc");
    assert.ok(done.expiresAt !== undefined && done.expiresAt >= before + 86_399_000);
  });

  it("without expires_in, invents no expiry", async () => {
    const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
    captureTokenPost({ access_token: "lin_oauth_abc" });
    const done = await linearRedirect.complete(
      started.exchange,
      {
        kind: ARRIVED_KIND.code,
        code: "c",
      },
      undefined,
    );
    // Absent, not "in a long time": "no known expiry" is not "never expires", and an invented expiry
    // would trigger renewal at an unrelated moment.
    assert.equal(done.expiresAt, undefined);
    assert.equal(done.refreshToken, undefined);
  });

  // `postForm` types its response by assertion (a cast `res.json()`), so a non-string `refresh_token`
  // would travel to `encryptSecret` and be stored unreadable, discovered at the first renewal months
  // later.
  it("ignores a non-string refresh_token rather than storing it", async () => {
    const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
    captureTokenPost({ access_token: "lin_oauth_abc", refresh_token: { nested: "object" } });
    const done = await linearRedirect.complete(
      started.exchange,
      {
        kind: ARRIVED_KIND.code,
        code: "c",
      },
      undefined,
    );
    assert.equal(done.accessToken, "lin_oauth_abc");
    assert.equal(
      done.refreshToken,
      undefined,
      "nothing rather than a secret that cannot be read back",
    );
  });

  // Symmetric to the device adapters refusing a `code`. `ProviderRefusal`, not a bare `Error`:
  // `routes.ts` reads every ordinary `Error` as a transport incident, "pending" forever.
  it("refuses to be polled, and the refusal is terminal", async () => {
    const started = await linearRedirect.begin({ projectId: "p1", field: undefined });
    await assert.rejects(
      () => linearRedirect.complete(started.exchange, { kind: ARRIVED_KIND.poll }, undefined),
      (e: unknown) => {
        assert.ok(
          e instanceof ProviderRefusal,
          "a bare Error would be read as a network failure and polled forever",
        );
        assert.match(String((e as Error).message), /does not restart/i);
        return true;
      },
    );
  });
});

describe("linear: what is missing to be usable", () => {
  it("first says it does not know where it is", () => {
    delete process.env.LEGION_PUBLIC_URL;
    assert.match(String(linearRedirect.unconfigured(undefined)), /LEGION_PUBLIC_URL/);
  });

  // The refusal carries the URL to copy: a guessed redirect URL off by one character gives an
  // unreadable refusal.
  it("then says which URL to register at the provider", () => {
    delete process.env.LEGION_LINEAR_CLIENT_ID;
    const why = String(linearRedirect.unconfigured(undefined));
    assert.match(why, /LEGION_LINEAR_CLIENT_ID required/);
    assert.ok(why.includes(CALLBACK), "the operator must be able to copy the URL from the refusal");
  });

  it("complains about nothing when both settings are present", () => {
    assert.equal(linearRedirect.unconfigured(undefined), null);
  });

  // No hard-coded address: an instance on a workstation (`http://localhost:8790`) or behind a
  // Tailscale name registers its own URL at Linear.
  it("follows the instance's public URL, whatever it is", async () => {
    process.env.LEGION_PUBLIC_URL = "http://localhost:8790/";
    const { params } = await authorizeParams();
    assert.equal(
      params.get("redirect_uri"),
      "http://localhost:8790/api/connections/callback",
      "the trailing / must be absorbed, or the URL differs by a character and Linear refuses",
    );
  });
});

// Adopting a pasted token. Linear is the only one of the three whose header format cannot be inferred
// from the token: a personal key goes raw, an OAuth token as `Bearer`. Checked: decided by trying, in
// the right order.
describe("Linear: adopting a pasted token", () => {
  /** `authorized` decides which header format Linear accepts; any other gets the 400 it returns for
   *  authentication it does not understand. */
  function stubViewer(
    authorized: string | null,
    viewer: Record<string, unknown> = { id: "u1", name: "Mona", email: "mona@example.test" },
  ): { seen: string[] } {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      assert.equal(String(url), "https://api.linear.app/graphql");
      const presented = new Headers(init?.headers).get("authorization") ?? "";
      seen.push(presented);
      if (authorized !== null && presented === authorized)
        return new Response(JSON.stringify({ data: { viewer } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    return { seen };
  }

  it("presents the raw key first: what is almost always pasted", async () => {
    const { seen } = stubViewer("lin_api_pasted");

    const adopted = await linearRedirect.adopt!("lin_api_pasted", undefined);

    assert.deepEqual(seen, ["lin_api_pasted"], "one attempt is enough when the first passes");
    assert.deepEqual(adopted, {
      scopes: null,
      account: "mona@example.test",
      authFormat: AUTH_FORMAT.raw,
    });
  });

  it("retries as Bearer for a pasted OAuth token rather than declaring it dead", async () => {
    const { seen } = stubViewer("Bearer lin_oauth_pasted");

    const adopted = await linearRedirect.adopt!("lin_oauth_pasted", undefined);

    assert.deepEqual(seen, ["lin_oauth_pasted", "Bearer lin_oauth_pasted"]);
    assert.equal(adopted!.account, "mona@example.test");
  });

  // The fact the 15/09 bug needed. `adopt` accepted a personal key at the first (raw) attempt without
  // remembering the form, and `integrations/linear.ts` then always sent `Bearer`: the token passed
  // adoption, the UI said "connected", and every GraphQL request failed. No test looked at what the
  // probe kept from the successful attempt; this one does, both ways.
  it("keeps the format of the successful attempt: raw for a key, Bearer for an OAuth token", async () => {
    stubViewer("lin_api_pasted");
    assert.equal(
      (await linearRedirect.adopt!("lin_api_pasted", undefined))!.authFormat,
      AUTH_FORMAT.raw,
      "a personal key accepted raw and read back as Bearer is dead in use",
    );

    stubViewer("Bearer lin_oauth_pasted");
    assert.equal(
      (await linearRedirect.adopt!("lin_oauth_pasted", undefined))!.authFormat,
      AUTH_FORMAT.bearer,
      "and the reverse would kill the pasted OAuth token",
    );
  });

  it("asserts no scopes: Linear does not publish a personal key's", async () => {
    stubViewer("lin_api_pasted");

    assert.equal(
      (await linearRedirect.adopt!("lin_api_pasted", undefined))!.scopes,
      null,
      "copying LINEAR_SCOPES would show as observed an access nobody observed",
    );
  });

  it("returns null when neither format passes", async () => {
    const { seen } = stubViewer(null);

    assert.equal(await linearRedirect.adopt!("lin_dead", undefined), null);
    assert.equal(seen.length, 2, "both formats were tried before concluding");
  });

  it("an empty 200 is not success: GraphQL carries errors in the body", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    assert.equal(await linearRedirect.adopt!("lin_api_pasted", undefined), null);
  });

  it("a 5xx throws rather than concluding refusal, without quoting the token", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;

    await assert.rejects(
      () => linearRedirect.adopt!("lin_api_valide", undefined),
      (e: Error) => !e.message.includes("lin_api_valide"),
      "a restarting instance must not produce “Linear refused this token”",
    );
  });
});

// A 429 is not a refusal. Added at the 15/09 self-review: the first version only threw above 500, so
// rate limiting read as "Linear did not recognise this token" and a valid token was declared dead.
describe("Linear: adoption, a transient incident is not a refusal", () => {
  it("throws on a 429 rather than concluding refusal", async () => {
    let appels = 0;
    globalThis.fetch = (async () => {
      appels += 1;
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;

    await assert.rejects(() => linearRedirect.adopt!("lin_api_valide", undefined));
    assert.equal(appels, 1, "no point trying the second format: it is not a refusal");
  });
});
