// GitLab device flow without network. The same cases as GitHub, since it is the same RFC: two adapters
// through the same port with the same translation table, neither hiding an optional field.
//
// Plus two cases of its own. GitHub hid that the host can vary: GitLab's OAuth endpoints live on its
// instance, and an OAuth app is registered per instance, so the wrong host means presenting a client
// id that does not exist there.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

process.env.LEGION_GITLAB_CLIENT_ID = "gl-client-test";
delete process.env.LEGION_GITLAB_HOST;

const { gitlabDevice } = await import("./gitlab-device.js");
const { ARRIVED_KIND, FLOW_KIND, FLOW_STATUS, ProviderRefusal, TOKEN_ORIGIN } =
  await import("./providers.js");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.LEGION_GITLAB_HOST;
  process.env.LEGION_GITLAB_CLIENT_ID = "gl-client-test";
});

/** Same double as for GitHub: the body is read as form parameters, not `JSON.parse`. */
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

/** The instance passed explicitly on every call. Before 15/09 `gitlab.com` was the adapter's silent
 *  default, so a framagit token was refused by `gitlab.com` with nothing in the code showing the
 *  assumption. A call that must name its instance can no longer assume it. */
const GITLAB_COM = "https://gitlab.com";

const DEVICE_PAYLOAD = {
  device_code: "gl_dc_abc",
  user_code: "GLAB-1234",
  verification_uri: "https://gitlab.com/oauth/device",
  expires_in: 900,
  interval: 5,
};

describe("GitLab device flow: start", () => {
  it("requests a code form-urlencoded and returns the device variant", async () => {
    const { calls } = stubFetch(DEVICE_PAYLOAD);

    const begun = await gitlabDevice.begin({ projectId: "p1", field: GITLAB_COM });

    assert.equal(calls[0]!.url, "https://gitlab.com/oauth/authorize_device");
    assert.equal(calls[0]!.contentType, "application/x-www-form-urlencoded");
    assert.deepEqual(calls[0]!.body, {
      client_id: "gl-client-test",
      scope: "api write_repository",
    });
    if (begun.kind !== FLOW_KIND.device) throw new Error("a device grant returns no redirect");
    assert.equal(begun.userCode, "GLAB-1234");
    assert.equal(begun.verificationUri, "https://gitlab.com/oauth/device");
    assert.equal(begun.intervalMs, 5000);
    assert.equal(begun.exchange, "gl_dc_abc", "the device_code stays on the server");
  });

  // D: same defect as GitHub, where the pattern came from: `Number("")` is zero.
  it("D: an empty string counts as missing, not zero", async () => {
    const before = Date.now();
    stubFetch({ ...DEVICE_PAYLOAD, expires_in: "", interval: "" });
    const begun = await gitlabDevice.begin({ projectId: "p1", field: GITLAB_COM });
    if (begun.kind !== FLOW_KIND.device) throw new Error("a device grant returns no redirect");
    assert.equal(begun.intervalMs, 5000);
    assert.ok(begun.expiresAt >= before + 900_000);
  });

  it("URL scopes derive from `scopes`: one truth, not two to sync", async () => {
    const { calls } = stubFetch(DEVICE_PAYLOAD);
    await gitlabDevice.begin({ projectId: "p1", field: GITLAB_COM });
    assert.equal((calls[0]!.body as Record<string, string>).scope, gitlabDevice.scopes.join(" "));
  });
});

describe("GitLab device flow: polling", () => {
  it("translates authorization_pending to pending", async () => {
    stubFetch({ error: "authorization_pending" });
    assert.deepEqual(
      await gitlabDevice.complete("gl_dc_abc", { kind: ARRIVED_KIND.poll }, GITLAB_COM),
      {
        status: FLOW_STATUS.pending,
      },
    );
  });

  it("translates slow_down to slow_down", async () => {
    stubFetch({ error: "slow_down" });
    assert.deepEqual(
      await gitlabDevice.complete("gl_dc_abc", { kind: ARRIVED_KIND.poll }, GITLAB_COM),
      {
        status: FLOW_STATUS.slowDown,
      },
    );
  });

  it("translates expired_token to expired", async () => {
    stubFetch({ error: "expired_token" });
    assert.deepEqual(
      await gitlabDevice.complete("gl_dc_abc", { kind: ARRIVED_KIND.poll }, GITLAB_COM),
      {
        status: FLOW_STATUS.expired,
      },
    );
  });

  it("translates access_denied to denied", async () => {
    stubFetch({ error: "access_denied" });
    assert.deepEqual(
      await gitlabDevice.complete("gl_dc_abc", { kind: ARRIVED_KIND.poll }, GITLAB_COM),
      {
        status: FLOW_STATUS.denied,
      },
    );
  });

  it("returns the token when GitLab said yes", async () => {
    stubFetch({ access_token: "glpat_neuf", token_type: "bearer", scope: "api" });
    assert.deepEqual(
      await gitlabDevice.complete("gl_dc_abc", { kind: ARRIVED_KIND.poll }, GITLAB_COM),
      {
        status: FLOW_STATUS.connected,
        accessToken: "glpat_neuf",
      },
    );
  });

  it("throws a terminal refusal on a non-RFC error code", async () => {
    stubFetch({ error: "unauthorized_client" });
    await assert.rejects(
      () => gitlabDevice.complete("gl_dc_abc", { kind: ARRIVED_KIND.poll }, GITLAB_COM),
      (err: unknown) =>
        err instanceof ProviderRefusal && /unauthorized_client/.test((err as Error).message),
      "routes.ts closes the flow on this error type, and only on it",
    );
  });

  it("refuses an authorisation code, which a device grant never receives", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("a device grant must call nothing for an authorisation code");
    }) as typeof fetch;
    await assert.rejects(
      () =>
        gitlabDevice.complete(
          "gl_dc_abc",
          { kind: ARRIVED_KIND.code, code: "ac_from_elsewhere" },
          undefined,
        ),
      // B: the type matters as much as the message; see `github-device.test.ts`.
      (err: unknown) =>
        err instanceof ProviderRefusal &&
        /receives no authorization code/i.test((err as Error).message),
    );
    assert.equal(called, false, "the refusal is decided here, not at GitLab");
  });
});

// What GitHub could not test. A client id is registered per instance, so calling `gitlab.com` with a
// self-hosted instance's client id (or the reverse) presents an id that does not exist there. The host
// belongs to the connection (15/09 fix: it was in the environment, global to the server).
describe("GitLab device flow: the instance", () => {
  it("uses the connection's host, on both endpoints", async () => {
    const { calls } = stubFetch(DEVICE_PAYLOAD);
    await gitlabDevice.begin({ projectId: "p1", field: "https://framagit.org" });
    assert.equal(calls[0]!.url, "https://framagit.org/oauth/authorize_device");

    const poll = stubFetch({ error: "authorization_pending" });
    await gitlabDevice.complete("gl_dc_abc", { kind: ARRIVED_KIND.poll }, "https://framagit.org");
    assert.equal(
      poll.calls[0]!.url,
      "https://framagit.org/oauth/token",
      "both endpoints follow the instance, not only the first",
    );
  });

  it("the connection's host wins over the env variable", async () => {
    process.env.LEGION_GITLAB_HOST = "https://git.example.com";
    const { calls } = stubFetch(DEVICE_PAYLOAD);
    await gitlabDevice.begin({ projectId: "p1", field: "https://framagit.org" });
    assert.equal(
      calls[0]!.url,
      "https://framagit.org/oauth/authorize_device",
      "the variable is an instance default; what is set on the connection wins",
    );
  });

  it("falls back to the env variable when the connection says nothing", async () => {
    process.env.LEGION_GITLAB_HOST = "https://git.example.com";
    const { calls } = stubFetch(DEVICE_PAYLOAD);
    await gitlabDevice.begin({ projectId: "p1", field: undefined });
    assert.equal(calls[0]!.url, "https://git.example.com/oauth/authorize_device");
  });

  it("tolerates a trailing `/` on the host rather than calling `//oauth/...`", async () => {
    const { calls } = stubFetch(DEVICE_PAYLOAD);
    await gitlabDevice.begin({ projectId: "p1", field: "https://git.example.com/" });
    assert.equal(calls[0]!.url, "https://git.example.com/oauth/authorize_device");
  });

  // The central guard: `gitlab.com` must never silently replace an unknown instance. That substitution
  // refused a valid framagit token with a message blaming the token.
  it("does not assume gitlab.com when neither connection nor instance says anything", () => {
    assert.match(
      String(gitlabDevice.unconfigured(undefined)),
      /GitLab instance URL required/,
      "without a host the refusal must name the missing host, not go to gitlab.com",
    );
  });
});

// The field this provider asks for: the only one of the three, and what the tile renders.
describe("GitLab device flow: the requested field", () => {
  it("suggests gitlab.com when the instance declares none", () => {
    assert.deepEqual(
      { name: gitlabDevice.field!().name, suggestion: gitlabDevice.field!().suggestion },
      { name: "host", suggestion: "https://gitlab.com" },
      "a displayed suggestion, not a silent assumption: it goes as shown",
    );
  });

  it("suggests the instance default when there is one: nothing to type for a single GitLab", () => {
    process.env.LEGION_GITLAB_HOST = "https://framagit.org";
    assert.equal(gitlabDevice.field!().suggestion, "https://framagit.org");
  });
});

describe("GitLab device flow: the three configuration refusals are distinct", () => {
  it("app missing, host present", () => {
    delete process.env.LEGION_GITLAB_CLIENT_ID;
    const refus = String(gitlabDevice.unconfigured(GITLAB_COM));
    assert.match(refus, /LEGION_GITLAB_CLIENT_ID required/);
    assert.doesNotMatch(refus, /GitLab instance URL required/);
  });

  it("host missing, app present", () => {
    const refus = String(gitlabDevice.unconfigured(""));
    assert.match(refus, /GitLab instance URL required/);
    assert.doesNotMatch(
      refus,
      /LEGION_GITLAB_CLIENT_ID required/,
      "“no app declared” does not help someone whose app exists: they would fix the wrong thing",
    );
  });

  it("both missing, and the sentence says so", () => {
    delete process.env.LEGION_GITLAB_CLIENT_ID;
    const refus = String(gitlabDevice.unconfigured(""));
    assert.match(refus, /GitLab instance URL required/);
    assert.match(refus, /LEGION_GITLAB_CLIENT_ID required/);
  });

  it("nothing missing when both are present", () => {
    assert.equal(gitlabDevice.unconfigured(GITLAB_COM), null);
  });
});

describe("GitLab: the revocation page follows the instance holding the token", () => {
  it("a pasted token points to its instance's personal tokens", () => {
    assert.equal(
      gitlabDevice.revokeUrl(TOKEN_ORIGIN.pasted, "https://framagit.org"),
      "https://framagit.org/-/user_settings/personal_access_tokens",
    );
  });

  it("a granted token points to its instance's applications", () => {
    assert.equal(
      gitlabDevice.revokeUrl(TOKEN_ORIGIN.granted, "https://framagit.org"),
      "https://framagit.org/-/user_settings/applications",
    );
  });

  // A link must lead somewhere and carries no token: the only place `gitlab.com` is still a last resort.
  it("falls back to gitlab.com rather than composing a relative URL", () => {
    assert.equal(
      gitlabDevice.revokeUrl(TOKEN_ORIGIN.pasted, undefined),
      "https://gitlab.com/-/user_settings/personal_access_tokens",
    );
  });
});

// Adopting a pasted token. Two calls answering different questions: the first decides refusal, the
// second gives scopes and may fail with a good token.
describe("GitLab: adopting a pasted token", () => {
  /** One response per called URL: the only way to play both probe calls and fail one without the other. */
  function stubByUrl(routes: Record<string, { status: number; body: unknown }>): {
    calls: { url: string; authorization: string | null }[];
  } {
    const calls: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const asked = String(url);
      calls.push({ url: asked, authorization: new Headers(init?.headers).get("authorization") });
      const hit = routes[asked] ?? { status: 404, body: { message: "404 Not Found" } };
      return new Response(JSON.stringify(hit.body), {
        status: hit.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    return { calls };
  }

  it("returns the account and scopes GitLab confirmed", async () => {
    const { calls } = stubByUrl({
      "https://gitlab.com/api/v4/user": { status: 200, body: { username: "mona" } },
      "https://gitlab.com/api/v4/personal_access_tokens/self": {
        status: 200,
        body: { scopes: ["api", "write_repository"] },
      },
    });

    const adopted = await gitlabDevice.adopt!("glpat_colle", GITLAB_COM);

    assert.equal(calls[0]!.authorization, "Bearer glpat_colle");
    assert.deepEqual(adopted, { scopes: ["api", "write_repository"], account: "mona" });
  });

  it("a token whose scopes GitLab refuses to describe stays valid", async () => {
    stubByUrl({
      "https://gitlab.com/api/v4/user": { status: 200, body: { username: "mona" } },
      // An OAuth token is not a PAT: this route refuses it, which says nothing about the token.
      "https://gitlab.com/api/v4/personal_access_tokens/self": {
        status: 403,
        body: { message: "403 Forbidden" },
      },
    });

    const adopted = await gitlabDevice.adopt!("glpat_etroit", GITLAB_COM);

    assert.equal(adopted!.account, "mona", "the token was recognised: it must not be refused");
    assert.equal(adopted!.scopes, null, "scopes are unknown, and written as such");
  });

  it("a token GitLab does not recognise returns null, and the probe stops there", async () => {
    const { calls } = stubByUrl({
      "https://gitlab.com/api/v4/user": { status: 401, body: { message: "401 Unauthorized" } },
    });

    assert.equal(await gitlabDevice.adopt!("glpat_mort", GITLAB_COM), null);
    assert.equal(calls.length, 1, "no point asking the scopes of a refused token");
  });

  // The case measured on 15/09: a real framagit token refused because the probe asked gitlab.com.
  // Probed again on its instance, the same token returns `rjeanjean · api`.
  it("follows the connection's instance, not gitlab.com", async () => {
    const { calls } = stubByUrl({
      "https://framagit.org/api/v4/user": { status: 200, body: { username: "rjeanjean" } },
      "https://framagit.org/api/v4/personal_access_tokens/self": {
        status: 200,
        body: { scopes: ["api"] },
      },
    });

    const adopted = await gitlabDevice.adopt!("glpat_colle", "https://framagit.org");

    assert.equal(calls[0]!.url, "https://framagit.org/api/v4/user");
    assert.deepEqual(adopted, { scopes: ["api"], account: "rjeanjean" });
  });

  it("the connection's host wins over the env variable", async () => {
    process.env.LEGION_GITLAB_HOST = "https://git.example.com";
    const { calls } = stubByUrl({
      "https://framagit.org/api/v4/user": { status: 200, body: { username: "rjeanjean" } },
      "https://framagit.org/api/v4/personal_access_tokens/self": {
        status: 200,
        body: { scopes: ["api"] },
      },
    });

    await gitlabDevice.adopt!("glpat_colle", "https://framagit.org");

    assert.equal(calls[0]!.url, "https://framagit.org/api/v4/user");
  });

  it("falls back to the instance default when the connection says nothing", async () => {
    process.env.LEGION_GITLAB_HOST = "https://git.example.com/";
    const { calls } = stubByUrl({
      "https://git.example.com/api/v4/user": { status: 200, body: { username: "mona" } },
      "https://git.example.com/api/v4/personal_access_tokens/self": {
        status: 200,
        body: { scopes: ["api"] },
      },
    });

    await gitlabDevice.adopt!("glpat_colle", undefined);

    assert.equal(calls[0]!.url, "https://git.example.com/api/v4/user");
  });

  it("a 5xx is not a refusal: it throws, and the token stays out of the message", async () => {
    stubByUrl({
      "https://gitlab.com/api/v4/user": { status: 502, body: { message: "bad gateway" } },
    });

    await assert.rejects(
      () => gitlabDevice.adopt!("glpat_valide", GITLAB_COM),
      (e: Error) => !e.message.includes("glpat_valide"),
    );
  });
});

// The 403 nuance, checked on the side relying on it. `probe` returns `null` on a 403 only without a
// quota header (correction round 1), while GitLab relies on the bare 403 of
// `/personal_access_tokens/self` to say "scopes unknown". Both readings must hold, or fixing GitHub
// breaks GitLab.
describe("GitLab: adoption, a bare 403 and a quota 403 do not mean the same", () => {
  function stubByUrl(routes: Record<string, { status: number; headers?: Record<string, string> }>) {
    globalThis.fetch = (async (url: string) => {
      const hit = routes[String(url)] ?? { status: 200 };
      return new Response(JSON.stringify({ username: "mona", scopes: ["api"] }), {
        status: hit.status,
        headers: { "content-type": "application/json", ...hit.headers },
      });
    }) as typeof fetch;
  }

  it("a bare 403 on scopes stays scopes unknown, not a refusal", async () => {
    stubByUrl({ "https://gitlab.com/api/v4/personal_access_tokens/self": { status: 403 } });

    const adopted = await gitlabDevice.adopt!("glpat_etroit", GITLAB_COM);

    assert.equal(adopted!.account, "mona");
    assert.equal(adopted!.scopes, null);
  });

  it("a quota 403 on scopes throws: unknown or unavailable cannot be told", async () => {
    stubByUrl({
      "https://gitlab.com/api/v4/personal_access_tokens/self": {
        status: 403,
        headers: { "retry-after": "60" },
      },
    });

    await assert.rejects(() => gitlabDevice.adopt!("glpat_valide", GITLAB_COM));
  });

  it("a quota 403 on `/user` does not declare the token unknown", async () => {
    stubByUrl({
      "https://gitlab.com/api/v4/user": { status: 403, headers: { "x-ratelimit-remaining": "0" } },
    });

    await assert.rejects(() => gitlabDevice.adopt!("glpat_valide", GITLAB_COM));
  });
});
