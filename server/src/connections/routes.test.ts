// The HTTP boundary of the connections domain. Not the device flow (that is
// `github-device.test.ts`) but what the routes do with it: refuse when no app is declared, never let
// the exchange secret out, and store the token under the canonical name when the provider says yes.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
// Pure `import type`: erased at compile time, so it does not load the module before the env variables
// below are set, which is why everything else uses dynamic imports.
import type { AuthFormat, ProviderKind } from "./providers.js";

const dir = mkdtempSync(join(tmpdir(), "legion-connections-routes-"));
process.env.LEGION_DB = join(dir, "test.db");
process.env.LEGION_MASTER_KEY ??= "0".repeat(64);
process.env.LEGION_GITHUB_CLIENT_ID = "Iv1.test";
// The real Linear adapter serves the callback tests, not a double: what is exercised is the agreement
// between the two halves (the `state` and `redirect_uri` the adapter puts in the authorisation URL,
// and the route that must find them). A double would prove the route can read a double.
process.env.LEGION_PUBLIC_URL = "https://legion.exemple.test";
process.env.LEGION_LINEAR_CLIENT_ID = "lin_client_test";
after(() => rmSync(dir, { recursive: true, force: true }));

const { db, schema } = await import("../shared/db.js");
const { freshSecret } = await import("./secret-access.js");
const { secretRowFor } = await import("./connections-store.js");
const {
  ARRIVED_KIND,
  AUTH_FORMAT,
  FLOW_KIND,
  FLOW_STATUS,
  PROVIDER,
  registerProvider,
  ProviderRefusal,
  TOKEN_ORIGIN,
} = await import("./providers.js");
const { registerConnectionRoutes } = await import("./routes.js");
// The real descriptor, to compare the route's answer with what it returns without copying its sentence.
const { githubDevice } = await import("./github-device.js");
const { putSecret } = await import("../projects/secrets.js");

// Two kinds reserved for tests, the only honest way to plug a double into the shared registry. Reusing
// `"gitlab"` or `"linear"` would overwrite a real adapter for the process: the first test reading
// `knownProviders()` (as `GET /api/connections` does) would see a ghost. The cast is local:
// `ProviderKind` lists the product's providers, not the tests'.
const TEST_DEVICE = "test-device" as ProviderKind;
const TEST_REDIRECT = "test-redirect" as ProviderKind;

// Several projects; the extra ones only serve the list: what it says about a credential depends on
// what is stored, and stacking credentials on `p1` would break the write tests that prove a non-write
// by comparing with the previous state.
db.insert(schema.projects)
  .values([
    { id: "p1", name: "one", slug: "one", createdAt: new Date() },
    { id: "p3", name: "three", slug: "three", createdAt: new Date() },
    { id: "p4", name: "four", slug: "four", createdAt: new Date() },
    // Two more projects (round 5), each for one fact: the account written by a completed flow, and the
    // flow completing anyway when the account probe is silent.
    { id: "p-account", name: "account", slug: "account", createdAt: new Date() },
    { id: "p-silent", name: "silent", slug: "silent", createdAt: new Date() },
    { id: "p-slow", name: "slow", slug: "slow", createdAt: new Date() },
  ])
  .run();

const app = new Hono();
registerConnectionRoutes(app);

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(responses: unknown[]): void {
  let i = 0;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("POST /api/connections/:provider/start", () => {
  it("refuses an unknown provider", async () => {
    const res = await app.request("/api/connections/bitbucket/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1" }),
    });
    assert.equal(res.status, 404);
  });

  it("refuses a body with an unknown key", async () => {
    const res = await app.request("/api/connections/github/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1", sournois: true }),
    });
    assert.equal(res.status, 400);
  });

  // H: the file header announced this refusal but nothing tested it, though it is the only branch
  // telling "this instance has no GitHub app" from a GitHub 502.
  it("refuses when no app is declared on this instance, without calling GitHub", async () => {
    // Empty string rather than `delete` (15/09): since the app is registered the adapter has a
    // non-empty `DEFAULT_CLIENT_ID`, and `??` only falls back on `undefined`, so deleting the variable
    // would make it configured and this test would prove nothing.
    const previousClientId = process.env.LEGION_GITHUB_CLIENT_ID;
    process.env.LEGION_GITHUB_CLIENT_ID = "";
    let fetchCalled = false;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("an unconfigured provider must never call the network");
    }) as typeof fetch;
    try {
      const res = await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as Record<string, unknown>;
      // C: the route passes on, it does not write. That invariant has not moved. What changed (round
      // 2) is the provider's sentence, which now names its variable. The previous assertion forbade
      // `LEGION_` in the response, measuring the provider's sentence rather than the route's
      // neutrality. Comparing with what the descriptor returns tests the right thing, and still fails
      // if the route starts writing a message.
      assert.equal(String(body.error), githubDevice.unconfigured(undefined));
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousClientId !== undefined) process.env.LEGION_GITHUB_CLIENT_ID = previousClientId;
    }
  });

  it("returns the code to type without ever returning the exchange secret", async () => {
    stubFetch([
      {
        device_code: "dc_secret",
        user_code: "WXYZ-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    ]);
    const res = await app.request("/api/connections/github/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.kind, FLOW_KIND.device, "the UI reads `kind` to know what to show");
    assert.equal(body.userCode, "WXYZ-1234");
    assert.ok(typeof body.flowId === "string" && body.flowId.length >= 16);
    assert.equal(
      JSON.stringify(body).includes("dc_secret"),
      false,
      "the device_code never crosses the HTTP boundary",
    );
  });

  // M: `start`'s `catch` returned `String((e as Error).message)` to the client; `postForm`'s transport
  // message quotes the URL, so GitHub's internal URL reached the browser, which `http/errors.ts`
  // forbids. And nothing was logged, unlike `poll`: invisible on both sides. Now aligned.
  it("M: a start incident is logged, and returns no internal URL to the client", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;

    const previousStderrWrite = process.stderr.write.bind(process.stderr);
    const stderrLines: string[] = [];
    process.stderr.write = ((chunk: string) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let res: Response;
    try {
      res = await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      });
    } finally {
      process.stderr.write = previousStderrWrite;
    }

    assert.equal(res.status, 502);
    const raw = await res.text();
    assert.equal(raw.includes("github.com"), false, "no internal URL reaches the browser");
    assert.equal(raw.includes("login/device"), false);
    assert.ok(
      stderrLines.some(
        (line) => line.includes("opening an OAuth flow") && line.includes("github.com"),
      ),
      "the detail goes to the terminal, where diagnosis happens",
    );
  });
});

describe("POST /api/connections/:provider/poll", () => {
  it("stores the token under the canonical name when GitHub says yes, with clear metadata never containing the token", async () => {
    stubFetch([
      {
        device_code: "dc_2",
        user_code: "ABCD-9999",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
      { access_token: "ghp_obtenu", token_type: "bearer", scope: "repo,user:email" },
    ]);
    const started = (await (
      await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    const res = await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: FLOW_STATUS.connected });
    assert.equal(freshSecret("p1", "GITHUB_TOKEN"), "ghp_obtenu");

    // I: the declared `metadata` invariant (never a secret) was only held by reading the code. Read the
    // raw row and prove both halves: the expected content is there in clear, and the token nowhere.
    const row = secretRowFor("p1", "GITHUB_TOKEN");
    assert.ok(row, "the row exists");
    // `probedAt` is left out of the comparison because it is a clock (round 6). Its presence is the
    // fact that matters: the account was asked, which takes the row out of adoption.
    const { probedAt, ...metadata } = JSON.parse(row!.metadata!) as Record<string, unknown>;
    assert.equal(typeof probedAt, "number");
    assert.deepEqual(metadata, {
      provider: PROVIDER.github,
      // Origin is written, no longer inferred from the column's presence: a pasted token carries one
      // too now.
      origin: TOKEN_ORIGIN.granted,
      scopes: ["repo", "read:org", "user:email"],
    });
    assert.equal(
      row!.metadata!.includes("ghp_obtenu"),
      false,
      "the token must never appear in clear in metadata",
    );
  });

  it("returns expired for an unknown flowId", async () => {
    const res = await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: "never-opened" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: FLOW_STATUS.expired });
  });

  // A: a flow is polled only at the provider that opened it. Without the check,
  // `/api/connections/gitlab/poll` with a GitHub flowId would post GitHub's `device_code` to
  // `gitlab.com/oauth/token`, and any token out of it would be stored as `GITLAB_TOKEN` with GitLab
  // scopes. Unreachable while only one device provider existed.
  it("A: a flow opened at one provider is not polled at another, and nothing goes out", async () => {
    stubFetch([
      {
        device_code: "dc_appartient_a_github",
        user_code: "OWNR-0001",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    ]);
    const started = (await (
      await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    let calledUrl: string | null = null;
    globalThis.fetch = (async (url: string) => {
      calledUrl = String(url);
      throw new Error("one provider's device_code must never go to another");
    }) as typeof fetch;

    const res = await app.request("/api/connections/gitlab/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.equal(res.status, 200);
    // Same answer as an unknown flowId: a probing caller cannot tell "no such flow" from "not here".
    assert.deepEqual(await res.json(), { status: FLOW_STATUS.expired });
    assert.equal(calledUrl, null, "no outgoing call: the refusal is decided before the adapter");

    // And the flow was not closed in passing: its owner polls it and gets an ordinary "pending", where
    // a closed flow would return "expired". Stop before success: storing a token here would change
    // `GITHUB_TOKEN` under later tests, which prove a non-write by comparing with the previous value.
    stubFetch([{ error: "authorization_pending" }]);
    const legitime = await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.deepEqual(
      await legitime.json(),
      { status: FLOW_STATUS.pending },
      "the owner's flow is intact",
    );
  });

  // A: `putSecret` can refuse to write (`LEGION_MASTER_KEY` missing) without throwing. Before this fix
  // the route closed the flow anyway and answered "connected" with nothing stored, losing the
  // device_code for good.
  it("A: does not close the flow and names the cause when putSecret refuses to write", async () => {
    stubFetch([
      {
        device_code: "dc_ratee",
        user_code: "RATE-0001",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
      { access_token: "ghp_never_lost", token_type: "bearer", scope: "repo,user:email" },
    ]);
    const started = (await (
      await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    const previousKey = process.env.LEGION_MASTER_KEY;
    delete process.env.LEGION_MASTER_KEY;
    let res: Response;
    try {
      res = await app.request("/api/connections/github/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId: started.flowId }),
      });
    } finally {
      // `freshSecret` decrypts, so it needs the master key: restore it before any read, even to check
      // the write failed.
      process.env.LEGION_MASTER_KEY = previousKey;
    }
    assert.equal(res.status, 400, "the status comes from putSecret, not a generic 502");
    const body = (await res.json()) as Record<string, unknown>;
    assert.match(String(body.error), /LEGION_MASTER_KEY/);
    // GITHUB_TOKEN already holds the previous test's value (one database for the file): the proof the
    // write was refused is that it did not change, not that it is null.
    assert.equal(freshSecret("p1", "GITHUB_TOKEN"), "ghp_obtenu", "the old value did not move");

    // The flow stayed open: a retry with the master key set succeeds without restarting the device
    // flow, proving nothing destroyed the device_code meanwhile.
    const retry = await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { status: FLOW_STATUS.connected });
    assert.equal(freshSecret("p1", "GITHUB_TOKEN"), "ghp_never_lost");
  });

  // J: a regression from the previous correction round. The `try` around `provider.poll` also covered
  // `putSecret`, so a real synchronous exception there fell into the network `catch` and came out
  // "pending". A master key present but too short passes `hasMasterKey()` (it only checks existence)
  // and makes `encryptSecret` throw inside `putSecret`: exactly the case that must escape the network
  // `try`.
  it("J: a putSecret exception is not swallowed as pending", async () => {
    stubFetch([
      {
        device_code: "dc_courte",
        user_code: "SHORT-0001",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
      { access_token: "ghp_inatteignable", token_type: "bearer", scope: "repo,user:email" },
    ]);
    const started = (await (
      await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    const previousKey = process.env.LEGION_MASTER_KEY;
    // Present (so `hasMasterKey()` is true and `putSecret` does not refuse early as in test A) but too
    // short: `encryptSecret` throws inside `putSecret`, outside the `try` around `provider.poll`.
    process.env.LEGION_MASTER_KEY = "trop-court";
    let res: Response;
    try {
      res = await app.request("/api/connections/github/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId: started.flowId }),
      });
    } finally {
      process.env.LEGION_MASTER_KEY = previousKey;
    }

    // This test app has no `app.onError` (unlike `http/app.ts`), so an uncaught exception becomes
    // Hono's generic 500. The exact status does not matter; what matters is that it is no longer the
    // 200 "pending" the regression produced.
    assert.equal(
      res.status,
      500,
      "the putSecret exception must surface, not be swallowed as pending",
    );
    assert.equal(
      (await res.text()).includes('"status":"pending"'),
      false,
      "the exception must never come out disguised as pending",
    );
  });

  // B: a transport incident (GitHub 5xx, network) is not a refusal: the device_code stays valid, and a
  // retry must succeed without restarting the flow.
  it("B: a GitHub 502 during polling does not destroy the flow", async () => {
    stubFetch([
      {
        device_code: "dc_transport",
        user_code: "TRAN-0001",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    ]);
    const started = (await (
      await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;

    // L: a transport incident must be logged server-side before the silent "pending", or a lasting
    // outage is indistinguishable from a slow operator. `createLogger` writes warn/error to
    // `process.stderr` (`shared/log.ts`), so that stream is intercepted during the call.
    const previousStderrWrite = process.stderr.write.bind(process.stderr);
    const stderrLines: string[] = [];
    process.stderr.write = ((chunk: string) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let res: Response;
    try {
      res = await app.request("/api/connections/github/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId: started.flowId }),
      });
    } finally {
      process.stderr.write = previousStderrWrite;
    }
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: FLOW_STATUS.pending });
    assert.ok(
      stderrLines.some((line) => line.includes("transport incident") && line.includes("github")),
      "the incident must leave a server trace, not just a silent pending",
    );

    stubFetch([
      { access_token: "ghp_after_incident", token_type: "bearer", scope: "repo,user:email" },
    ]);
    const retry = await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { status: FLOW_STATUS.connected });
  });

  // B, by contrast: a terminal refusal (app not enabled) must close the flow; polling would change
  // nothing, GitHub will keep answering `device_flow_disabled` for this device_code.
  it("B (contrast): a terminal provider refusal closes the flow", async () => {
    stubFetch([
      {
        device_code: "dc_refuse",
        user_code: "REFU-0001",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
    ]);
    const started = (await (
      await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    stubFetch([{ error: "device_flow_disabled" }]);
    const res = await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.equal(res.status, 502);
    assert.match(String((await res.json()).error), /device flow/i);

    const after = await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.deepEqual(await after.json(), { status: FLOW_STATUS.expired }, "the flow was closed");
  });

  // E: `ConnectionProvider.complete` allows "connected" without `accessToken`; the real adapters never
  // produce it, but the route must defend against it.
  it("E: connected without a token is an error, not a success", async () => {
    registerProvider({
      kind: TEST_DEVICE,
      secretName: "DEVICE_TOKEN_TEST_ONLY",
      scopes: ["test-only"],
      unconfigured: () => null,
      revokeUrl: () => "https://example.test/settings/applications",
      begin: async () => ({
        kind: FLOW_KIND.device,
        userCode: "LINK-0001",
        verificationUri: "https://example.test/device",
        intervalMs: 1000,
        expiresAt: Date.now() + 60_000,
        exchange: "exch_no_token",
      }),
      complete: async () => ({ status: FLOW_STATUS.connected }), // no accessToken: case E
    });

    const started = (await (
      await app.request("/api/connections/test-device/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    const res = await app.request("/api/connections/test-device/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.equal(res.status, 502);
    assert.match(String((await res.json()).error), /without an access token/i);
    assert.equal(freshSecret("p1", "DEVICE_TOKEN_TEST_ONLY"), null, "nothing was written");
  });
});

// The step that justified reshaping the port. An adapter of the other family (authorisation comes back
// through the browser, not our polling) goes through the same start route without `routes.ts` knowing.
// Were the union a bag of optional fields these tests would pass too and prove nothing: the absence of
// `userCode` is what makes them informative.
describe("POST /api/connections/:provider/start: the redirect family", () => {
  registerProvider({
    kind: TEST_REDIRECT,
    secretName: "REDIRECT_TOKEN_TEST_ONLY",
    scopes: ["test-only"],
    unconfigured: () => null,
    revokeUrl: () => "https://example.test/settings/applications",
    begin: async () => ({
      kind: FLOW_KIND.redirect,
      authorizeUrl: "https://example.test/oauth/authorize?state=st_public",
      expiresAt: Date.now() + 60_000,
      exchange: "verifier_secret_pkce",
    }),
    complete: async (_exchange, arrived) => {
      // A redirect flow is not polled: it waits for the browser. Refusing by name mirrors a device
      // grant refusing a `code`, and `ProviderRefusal`, not a bare `Error`, which the route would read
      // as a transport incident, "pending" forever (see B).
      if (arrived.kind === ARRIVED_KIND.poll)
        throw new ProviderRefusal(
          "A redirect flow does not restart: it is waiting for its callback.",
        );
      return { status: FLOW_STATUS.connected, accessToken: "tok_redirect" };
    },
  });

  it("returns the redirect variant as is, and no userCode", async () => {
    const res = await app.request("/api/connections/test-redirect/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.kind, FLOW_KIND.redirect);
    assert.equal(body.authorizeUrl, "https://example.test/oauth/authorize?state=st_public");
    assert.equal(typeof body.expiresAt, "number");
    assert.ok(typeof body.flowId === "string" && body.flowId.length >= 16);
    // The line that matters. With optional fields `userCode` would just be `undefined`, and nobody could
    // tell a redirect flow from a broken device grant.
    assert.equal("userCode" in body, false, "a redirect flow has no code to type");
    assert.equal("verificationUri" in body, false);
    assert.equal("intervalMs" in body, false);
  });

  it("a redirect flow's exchange secret does not cross the HTTP boundary either", async () => {
    const res = await app.request("/api/connections/test-redirect/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1" }),
    });
    const raw = await res.text();
    // The PKCE `code_verifier` has the `device_code`'s property: known to the browser, it voids the
    // flow's guarantee. The route does not tell them apart; it removes `exchange` whatever the family.
    assert.equal(
      raw.includes("verifier_secret_pkce"),
      false,
      "the code_verifier stays on the server",
    );
    assert.equal(raw.includes("exchange"), false, "the field itself does not leave either");
  });

  // B: polling a redirect flow is a programming error, not a network failure. While the adapter threw a
  // bare `Error`, the route read it as a transport incident: "pending" on every tick forever, logging a
  // fake incident, never closing a flow that could not succeed this way. `ProviderRefusal` puts it on
  // the right side: 502, the named refusal, and the flow closed.
  it("B: polling a redirect flow is a terminal refusal, not an endless pending", async () => {
    const started = (await (
      await app.request("/api/connections/test-redirect/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      })
    ).json()) as { flowId: string };

    const res = await app.request("/api/connections/test-redirect/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.equal(
      res.status,
      502,
      "a 200 pending would be the network failure we do not want to simulate",
    );
    assert.match(String((await res.json()).error), /does not restart/i);

    const encore = await app.request("/api/connections/test-redirect/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });
    assert.deepEqual(await encore.json(), { status: FLOW_STATUS.expired }, "the flow was closed");
  });
});

// ── The browser's return ──
//
// The most exposed route of the domain: a `GET` not authenticated by what it carries, which writes a
// secret. `mutationOriginGuard` does not cover this verb and cannot (the browser arrives from the
// provider). The `state` guards it, and these tests prove it really guards something.
//
// The real Linear adapter, not a double: what is exercised is the agreement between the `state` it puts
// in the URL and the route that must find it, and between its `redirect_uri` and the path `app.get`
// serves.
describe("GET /api/connections/callback", () => {
  const TOKEN = {
    access_token: "lin_oauth_ok",
    refresh_token: "lin_refresh_ok",
    expires_in: 86399,
  };

  /** Opens a real Linear flow and returns what the browser will carry: the consent URL. */
  async function startLinear(): Promise<URL> {
    stubFetch([{}]);
    const res = await app.request("/api/connections/linear/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { authorizeUrl: string };
    return new URL(body.authorizeUrl);
  }

  async function callback(query: string): Promise<Response> {
    return app.request(`/api/connections/callback?${query}`);
  }

  it("stores the token, its refresh token and expiry, then sends the operator back to the screen", async () => {
    const authorize = await startLinear();
    const state = authorize.searchParams.get("state") ?? "";
    stubFetch([TOKEN]);

    const res = await callback(`state=${encodeURIComponent(state)}&code=le_code`);

    assert.equal(res.status, 302, "an operator must not stay on an API page");
    assert.equal(res.headers.get("location"), "/p/p1/project/integrations");
    assert.equal(freshSecret("p1", "LINEAR_TOKEN"), "lin_oauth_ok");

    const row = secretRowFor("p1", "LINEAR_TOKEN");
    // The refresh token is encrypted like the value. `putSecret` does it; this checks it was passed in
    // clear and did not land as is in the database.
    assert.ok(row?.refreshCiphertext);
    assert.notEqual(row?.refreshCiphertext, "lin_refresh_ok");

    const metadata = JSON.parse(row?.metadata ?? "{}") as Record<string, unknown>;
    assert.equal(metadata.provider, "linear");
    assert.deepEqual(metadata.scopes, ["read", "write"]);
    // The expiry in epoch milliseconds, computed from `expires_in`: what renewal will read.
    assert.ok(typeof metadata.expiresAt === "number" && metadata.expiresAt > Date.now());
    // No secret in `metadata`: the column's invariant, stored in clear and read by the UI.
    const raw = row?.metadata ?? "";
    assert.equal(raw.includes("lin_oauth_ok"), false, "the token never enters metadata");
    assert.equal(raw.includes("lin_refresh_ok"), false, "nor the refresh token");
  });

  // The `state` is single use, its most important property: otherwise a `code` or `state` found in a
  // history, a proxy log or a `Referer` header could be replayed. The first pass consumes it, success or
  // not.
  it("refuses a replayed state, even right after a success", async () => {
    const authorize = await startLinear();
    const state = authorize.searchParams.get("state") ?? "";
    stubFetch([TOKEN]);
    assert.equal((await callback(`state=${encodeURIComponent(state)}&code=c1`)).status, 302);

    const encore = await callback(`state=${encodeURIComponent(state)}&code=c2`);
    assert.equal(encore.status, 400);
    assert.match(String((await encore.json()).error), /already been used|expired/i);
  });

  it("refuses an unknown state", async () => {
    const res = await callback("state=linear.jamais_emis&code=c");
    assert.equal(res.status, 400);
  });

  it("refuses a state whose provider does not exist", async () => {
    const res = await callback("state=bitbucket.peu_importe&code=c");
    assert.equal(res.status, 400);
  });

  // A flow claimed for another provider. The `state` prefix designates the adapter and proves nothing
  // (the caller writes it). Without the ownership check a Linear `code` would be exchanged for a token
  // stored as `GITHUB_TOKEN` with GitHub scopes in its `metadata`.
  it("refuses a state claimed for another provider", async () => {
    const authorize = await startLinear();
    const state = authorize.searchParams.get("state") ?? "";
    const usurpe = `github.${state.slice("linear.".length)}`;
    stubFetch([TOKEN]);

    const res = await callback(`state=${encodeURIComponent(usurpe)}&code=c`);
    assert.equal(res.status, 400);

    // And the legitimate flow survives: a forgery must not cancel someone else's flow by claiming it.
    // That is why the ownership check comes before consumption.
    stubFetch([TOKEN]);
    assert.equal((await callback(`state=${encodeURIComponent(state)}&code=c`)).status, 302);
  });

  it("refuses a callback without state", async () => {
    const res = await callback("code=c");
    assert.equal(res.status, 400);
    assert.match(String((await res.json()).error), /state/);
  });

  // Three causes used to land in the same 400 with the same message: missing `state`, empty `code`,
  // empty `error`. Naming `state` in all three points to the wrong place, in the refusal read in a log
  // without the request to replay.
  it("names the faulty parameter, not `state` by default", async () => {
    const res = await callback("state=linear.x&code=");
    assert.equal(res.status, 400);
    const error = String((await res.json()).error);
    assert.match(error, /code/);
    assert.doesNotMatch(
      error,
      /state/,
      "the state was there: blaming it sends people looking elsewhere",
    );
  });

  // The operator clicked "Deny". Not a failure: nothing to store, back to the screen where Linear is
  // still disconnected.
  it("brings the operator back to the screen when the provider refuses", async () => {
    const authorize = await startLinear();
    const state = authorize.searchParams.get("state") ?? "";
    const res = await callback(`state=${encodeURIComponent(state)}&error=access_denied`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/p/p1/project/integrations");
  });

  // The `code_verifier` never crosses the HTTP boundary, neither out (`start` removes `exchange`) nor
  // back (the browser brings only `code` and `state`). That is PKCE's whole guarantee.
  it("the code_verifier leaves at neither end", async () => {
    stubFetch([{}]);
    const res = await app.request("/api/connections/linear/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1" }),
    });
    const raw = await res.text();
    assert.equal(raw.includes("exchange"), false, "the field itself does not leave");
    assert.equal(raw.includes("code_verifier"), false);
    const authorize = new URL((JSON.parse(raw) as { authorizeUrl: string }).authorizeUrl);
    assert.ok(authorize.searchParams.get("code_challenge"), "only the hash leaves");
    assert.equal(authorize.searchParams.get("code_verifier"), null);
  });

  // The served path is the one sent to Linear. Both are literals on their own side
  // (`scripts/api-contract.ts` reads literals). This test links them: a mismatch breaks here, not for
  // an operator coming back from Linear to a 404.
  it("the path announced to Linear is the one the server serves", async () => {
    const authorize = await startLinear();
    const annonce = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    const res = await app.request(`${annonce.pathname}?state=linear.inconnu&code=c`);
    assert.notEqual(res.status, 404, "the URL registered at Linear leads nowhere");
  });

  // Missing configuration carries the URL to copy; a guessed URL off by one character gives an
  // unreadable refusal.
  it("the no-app refusal shows the redirect URL to register", async () => {
    const previous = process.env.LEGION_LINEAR_CLIENT_ID;
    process.env.LEGION_LINEAR_CLIENT_ID = "";
    const res = await app.request("/api/connections/linear/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1" }),
    });
    process.env.LEGION_LINEAR_CLIENT_ID = previous;
    assert.equal(res.status, 400);
    assert.match(
      String((await res.json()).error),
      /https:\/\/legion\.exemple\.test\/api\/connections\/callback/,
    );
  });
});

// Adopting a pasted token, the second acquisition path. Not the probe (each adapter's test) but what the
// route does with its verdict: write nothing on refusal, write only observed scopes, and let the token
// out nowhere.
describe("POST /api/connections/:provider/adopt", () => {
  const TEST_ADOPT = "test-adopt" as ProviderKind;
  const TEST_BLIND = "test-blind" as ProviderKind;

  /** What the test provider's probe will return next. A variable rather than one provider per case:
   *  the registry is shared by the process, and stacking providers would leave ghosts in
   *  `GET /api/connections`. */
  let verdict: (token: string) => Promise<{
    scopes: string[] | null;
    account: string | null;
    authFormat?: AuthFormat;
  } | null>;

  registerProvider({
    kind: TEST_ADOPT,
    secretName: "ADOPT_TOKEN_TEST_ONLY",
    // The descriptor's scopes are deliberately recognisable: if one lands in a pasted token's
    // `metadata`, the route made up what it does not know.
    scopes: ["requested-never-observed"],
    unconfigured: () => null,
    revokeUrl: () => "https://example.test/settings/applications",
    adopt: (token) => verdict(token),
    begin: async () => {
      throw new Error("this test provider only serves adoption");
    },
    complete: async () => {
      throw new Error("this test provider only serves adoption");
    },
  });

  registerProvider({
    kind: TEST_BLIND,
    secretName: "BLIND_TOKEN_TEST_ONLY",
    scopes: ["requested-never-observed"],
    unconfigured: () => null,
    revokeUrl: () => "https://example.test/settings/applications",
    // No `adopt`: a provider that cannot probe stays usable.
    begin: async () => {
      throw new Error("this test provider only serves adoption");
    },
    complete: async () => {
      throw new Error("this test provider only serves adoption");
    },
  });

  const adopt = (provider: string, body: unknown) =>
    app.request(`/api/connections/${provider}/adopt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses an unknown provider", async () => {
    assert.equal((await adopt("bitbucket", { projectId: "p1", token: "t" })).status, 404);
  });

  it("refuses a body without a token, and a body carrying too much", async () => {
    assert.equal((await adopt("test-adopt", { projectId: "p1" })).status, 400);
    assert.equal(
      (await adopt("test-adopt", { projectId: "p1", token: "t", sournois: true })).status,
      400,
    );
  });

  it("a token the provider refuses writes nothing", async () => {
    verdict = async () => null;

    const res = await adopt("test-adopt", { projectId: "p1", token: "tok_mort" });

    assert.equal(res.status, 400);
    assert.equal(
      secretRowFor("p1", "ADOPT_TOKEN_TEST_ONLY"),
      null,
      "a dead credential in the database would show “connected”",
    );
  });

  it("stores observed scopes, never those the descriptor requests", async () => {
    verdict = async () => ({ scopes: ["constatee-a", "constatee-b"], account: "mona" });

    const res = await adopt("test-adopt", { projectId: "p1", token: "tok_vivant" });

    assert.equal(res.status, 200);
    assert.equal(freshSecret("p1", "ADOPT_TOKEN_TEST_ONLY"), "tok_vivant");
    const row = secretRowFor("p1", "ADOPT_TOKEN_TEST_ONLY");
    assert.deepEqual(JSON.parse(row!.metadata!), {
      provider: TEST_ADOPT,
      origin: TOKEN_ORIGIN.pasted,
      account: "mona",
      scopes: ["constatee-a", "constatee-b"],
    });
    assert.equal(
      row!.metadata!.includes("requested-never-observed"),
      false,
      "the descriptor's scopes have no place on a pasted token: nobody granted them",
    );
    assert.equal(
      row!.refreshCiphertext,
      null,
      "a pasted token cannot be renewed, and `renewable` must say so",
    );
  });

  it("the token comes out in neither the response, the metadata nor the log", async () => {
    verdict = async () => ({ scopes: null, account: null });
    const written: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    const realOut = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const res = await adopt("test-adopt", { projectId: "p1", token: "tok_ultra_secret" });
      const body = await res.text();
      assert.equal(
        body.includes("tok_ultra_secret"),
        false,
        "the response does not return the token",
      );
    } finally {
      process.stderr.write = realWrite;
      process.stdout.write = realOut;
    }
    assert.equal(
      written.join("").includes("tok_ultra_secret"),
      false,
      "a secret in the terminal is a published secret",
    );
    assert.equal(
      secretRowFor("p1", "ADOPT_TOKEN_TEST_ONLY")!.metadata!.includes("tok_ultra_secret"),
      false,
      "`metadata` is clear JSON: no secret ever enters it",
    );
  });

  it("a probe without scopes asserts none rather than inventing them", async () => {
    verdict = async () => ({ scopes: null, account: "mona" });

    await adopt("test-adopt", { projectId: "p1", token: "tok_fine_grained" });

    const metadata = JSON.parse(secretRowFor("p1", "ADOPT_TOKEN_TEST_ONLY")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal("scopes" in metadata, false, "“unknown” is omitted, not written empty");
    assert.equal(metadata.account, "mona");
  });

  // The header format travels to the column by one path: the probe observes it, the route writes it,
  // the reader reads it. Without it a Linear personal key accepted raw goes back out as `Bearer` (the
  // 15/09 bug).
  it("stores the header format the probe observed", async () => {
    verdict = async () => ({ scopes: null, account: null, authFormat: AUTH_FORMAT.raw });

    await adopt("test-adopt", { projectId: "p1", token: "tok_brut" });

    const metadata = JSON.parse(secretRowFor("p1", "ADOPT_TOKEN_TEST_ONLY")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal(metadata.authFormat, AUTH_FORMAT.raw);
  });

  // And it is not invented. A provider with one way to read tokens has nothing to observe: the column
  // stays silent, read as `bearer`. Writing an unobserved format is the same fault as made-up scopes.
  it("writes no format when the probe observed none", async () => {
    verdict = async () => ({ scopes: null, account: null });

    await adopt("test-adopt", { projectId: "p1", token: "tok_no_format" });

    const metadata = JSON.parse(secretRowFor("p1", "ADOPT_TOKEN_TEST_ONLY")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.equal("authFormat" in metadata, false);
  });

  // The third state, all the way to the UI. `[]` is not `null`: the provider answered "no access". A
  // classic PAT with no scope really produces it (GitHub returns an empty `x-oauth-scopes`, played in
  // `github-device.test.ts`). This leg was only held at the probe, with nothing proving it survived
  // `metadata` and the list.
  it("an empty list is a fact: it is written, where “unknown” is omitted", async () => {
    verdict = async () => ({ scopes: [], account: "mona" });

    await adopt("test-adopt", { projectId: "p1", token: "tok_no_scope" });

    const metadata = JSON.parse(secretRowFor("p1", "ADOPT_TOKEN_TEST_ONLY")!.metadata!) as Record<
      string,
      unknown
    >;
    assert.deepEqual(metadata.scopes, []);
    // The read half is proven on a real provider in the list below. When this test was written,
    // `CredentialMetadata.provider` was a `z.enum(PROVIDERS)` and a test provider's `metadata` did not
    // read back; it is a plain string now (see `schemas.ts`).
  });

  it("a provider without a probe stores the token asserting nothing about scopes", async () => {
    const res = await adopt("test-blind", { projectId: "p1", token: "tok_aveugle" });

    assert.equal(res.status, 200);
    assert.equal(freshSecret("p1", "BLIND_TOKEN_TEST_ONLY"), "tok_aveugle");
    assert.deepEqual(JSON.parse(secretRowFor("p1", "BLIND_TOKEN_TEST_ONLY")!.metadata!), {
      provider: TEST_BLIND,
      origin: TOKEN_ORIGIN.pasted,
    });
  });

  it("a transport incident writes nothing and says it is transient", async () => {
    verdict = async () => {
      throw new Error("ECONNRESET to the provider");
    };

    const res = await adopt("test-adopt", { projectId: "p2-never-written", token: "tok_valid" });

    assert.equal(res.status, 502);
    assert.equal(
      secretRowFor("p2-never-written", "ADOPT_TOKEN_TEST_ONLY"),
      null,
      "a provider outage says nothing about the token: nothing stored at random",
    );
  });

  // The route writes a secret, so it must be behind the operator session. Not because the path starts
  // with `/api/`, but because nothing exempts it, and the only way to know is to mount the guards as
  // `http/app.ts` does.
  it("is refused without an operator session, and writes nothing", async () => {
    const { mutationOriginGuard } = await import("../http/guard.js");
    const { operatorGuard } = await import("../operator/operator-guard.js");
    const guarded = new Hono();
    guarded.use("*", mutationOriginGuard);
    guarded.use("*", operatorGuard);
    registerConnectionRoutes(guarded);
    verdict = async () => ({ scopes: null, account: null });
    // Read before, not hard-coded: the stored value depends on earlier tests, and a literal would fail
    // this test for the wrong reason when one of them changes its token (which just happened).
    const avant = freshSecret("p1", "ADOPT_TOKEN_TEST_ONLY");

    const res = await guarded.request("/api/connections/test-adopt/adopt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p1", token: "tok_intrus" }),
    });

    assert.equal(res.status, 401);
    assert.equal(
      freshSecret("p1", "ADOPT_TOKEN_TEST_ONLY"),
      avant,
      "the stored secret is intact: nothing was written",
    );
    assert.notEqual(avant, "tok_intrus");
  });
});

// The two questions that used to be merged. `renewable` said "this token comes from a connection" by
// reading `metadata !== null`; it now says "I can renew it" by reading `refresh_ciphertext`. They
// diverge both ways, and this holds both.
describe("GET /api/connections: where the token comes from, and whether it can be renewed", () => {
  const find = async (provider: string) => {
    const res = await app.request("/api/connections?projectId=p3");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    return body.connections.find((c) => c.provider === provider)!;
  };

  it("nothing stored: no origin, no scopes, and above all no empty list", async () => {
    const github = await find(PROVIDER.github);
    assert.equal(github.connected, false);
    assert.equal(github.renewable, false);
    assert.equal(github.origin, null);
    assert.equal(github.scopes, null);
  });

  it("a granted token without renewal says granted, not renewable", async () => {
    // Today's GitHub connection: "Expire user access tokens" unchecked, so no refresh token. The old
    // signal declared it renewable.
    putSecret({
      projectId: "p3",
      name: "GITHUB_TOKEN",
      value: "ghp_accorde",
      metadata: { provider: PROVIDER.github, origin: TOKEN_ORIGIN.granted, scopes: ["repo"] },
    });

    const github = await find(PROVIDER.github);
    assert.equal(github.connected, true);
    assert.equal(github.renewable, false, "without a refresh token Legion cannot renew it");
    assert.equal(github.origin, TOKEN_ORIGIN.granted);
    assert.deepEqual(github.scopes, ["repo"], "access stays shown: it did come from a flow");
  });

  it("a granted token with renewal is the only one saying renewable", async () => {
    putSecret({
      projectId: "p3",
      name: "LINEAR_TOKEN",
      value: "lin_accorde",
      refreshToken: "lin_refresh",
      metadata: { provider: PROVIDER.linear, origin: TOKEN_ORIGIN.granted, scopes: ["read"] },
    });

    assert.equal((await find(PROVIDER.linear)).renewable, true);
  });

  it("a pasted token carries metadata without coming from a connection", async () => {
    putSecret({
      projectId: "p3",
      name: "GITLAB_TOKEN",
      value: "glpat_colle",
      metadata: { provider: PROVIDER.gitlab, origin: TOKEN_ORIGIN.pasted, account: "mona" },
    });

    const gitlab = await find(PROVIDER.gitlab);
    assert.equal(gitlab.connected, true);
    assert.equal(
      gitlab.origin,
      TOKEN_ORIGIN.pasted,
      "metadata no longer proves anything about origin",
    );
    assert.equal(gitlab.renewable, false);
    assert.equal(gitlab.scopes, null, "the probe observed nothing: no list shown");
    assert.equal(gitlab.account, "mona");
  });

  // The three scope states seen by the list, telling them apart being the task. `["repo"]` is proven
  // above, `null` below; this is the third.
  it("`[]` goes through the list without collapsing to `null`: the provider answered “no access”", async () => {
    putSecret({
      projectId: "p4",
      name: "GITLAB_TOKEN",
      value: "glpat_no_scope",
      metadata: { provider: PROVIDER.gitlab, origin: TOKEN_ORIGIN.pasted, scopes: [] },
    });

    const res = await app.request("/api/connections?projectId=p4");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    const gitlab = body.connections.find((c) => c.provider === PROVIDER.gitlab)!;

    assert.deepEqual(
      gitlab.scopes,
      [],
      "collapsed to `null`, the UI would say “unknown” of a token known to do nothing",
    );
  });

  it("a hand-stored secret without metadata reads as pasted", async () => {
    putSecret({ projectId: "p4", name: "GITHUB_TOKEN", value: "ghp_a_la_main" });

    const res = await app.request("/api/connections?projectId=p4");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    const github = body.connections.find((c) => c.provider === PROVIDER.github)!;
    assert.equal(github.connected, true);
    assert.equal(github.origin, TOKEN_ORIGIN.pasted);
    assert.equal(github.scopes, null);
  });

  // Unreadable `metadata` does not read as pasted. It really happens (truncated JSON, an older shape, a
  // removed provider). Without the distinction a granted credential would show "Pasted token: the
  // provider does not know Legion exists", a false sentence given as fact.
  it("unreadable metadata gives no origin rather than a false one", async () => {
    putSecret({
      projectId: "p4",
      name: "LINEAR_TOKEN",
      value: "lin_accorde",
      metadata: { provider: PROVIDER.linear, origin: TOKEN_ORIGIN.granted },
    });
    // Written by hand, since no product path produces it: the past, or a damaged row.
    db.update(schema.secrets)
      .set({ metadata: "{truncated" })
      // Both columns in the filter: `LINEAR_TOKEN` also exists on `p1`, and damaging another project's
      // row would break a neighbour far away.
      .where(and(eq(schema.secrets.projectId, "p4"), eq(schema.secrets.name, "LINEAR_TOKEN")))
      .run();

    const res = await app.request("/api/connections?projectId=p4");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    const linear = body.connections.find((c) => c.provider === PROVIDER.linear)!;

    assert.equal(linear.connected, true, "the token is there: it does not vanish from the UI");
    assert.equal(linear.origin, null, "its origin is unknown, and not guessed");
    assert.equal(linear.scopes, null);
  });

  it("carries the reason for a disabled button, so the refusal reads before the click", async () => {
    const previous = process.env.LEGION_GITHUB_CLIENT_ID;
    process.env.LEGION_GITHUB_CLIENT_ID = "";
    try {
      assert.match(String((await find(PROVIDER.github)).unconfigured), /LEGION_GITHUB_CLIENT_ID/);
    } finally {
      if (previous !== undefined) process.env.LEGION_GITHUB_CLIENT_ID = previous;
    }
  });

  it("says since when, and `null` where there is nothing to date", async () => {
    const github = await find(PROVIDER.github);
    assert.equal(typeof github.connectedAt, "number");
    assert.ok(Number(github.connectedAt) > 0);
    // A project where nothing is stored: no tile has a date, the only setup independent of test order.
    const res = await app.request("/api/connections?projectId=p-sans-rien");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    assert.ok(body.connections.length > 0);
    assert.ok(
      body.connections.every((c) => c.connectedAt === null),
      "dating what does not exist would invent a fact",
    );
  });

  // The link comes from the provider, which makes it right on a self-hosted instance. A UI-side table
  // would revoke on `gitlab.com` a token granted elsewhere.
  it("carries the address where the token is really revoked, on the instance holding it", async () => {
    const previous = process.env.LEGION_GITLAB_HOST;
    process.env.LEGION_GITLAB_HOST = "https://git.exemple.fr";
    try {
      assert.match(
        String((await find(PROVIDER.gitlab)).revokeUrl),
        /^https:\/\/git\.exemple\.fr\//,
        "a hard-coded link would revoke on an instance where nothing was granted",
      );
    } finally {
      if (previous === undefined) delete process.env.LEGION_GITLAB_HOST;
      else process.env.LEGION_GITLAB_HOST = previous;
    }
  });

  // Two pages, origin decides (round 1 fix): a pasted token is almost always personal and does not
  // appear on the authorised apps page.
  it("sends a pasted token to the tokens page, not the applications page", async () => {
    // `p3` carries a granted GITHUB_TOKEN and a pasted GITLAB_TOKEN, stored earlier in this block.
    assert.equal(
      (await find(PROVIDER.github)).revokeUrl,
      "https://github.com/settings/applications",
      "an OAuth grant is revoked in authorised applications",
    );
    assert.equal(
      (await find(PROVIDER.gitlab)).revokeUrl,
      "https://gitlab.com/-/user_settings/personal_access_tokens",
      "a pasted token is not listed among authorised applications",
    );

    // Both legs on the same provider, which was missing: while GitHub only served the granted case and
    // GitLab the pasted one, a descriptor ignoring origin passed both assertions. Measured: the
    // mutation survived.
    const res = await app.request("/api/connections?projectId=p4");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    const github = body.connections.find((c) => c.provider === PROVIDER.github)!;
    assert.equal(github.origin, TOKEN_ORIGIN.pasted, "p4 carries a hand-stored GITHUB_TOKEN");
    assert.equal(
      github.revokeUrl,
      "https://github.com/settings/tokens",
      "the same provider must change page with origin, or the argument falls",
    );
  });

  it("designates no page when the token's origin is unknown", async () => {
    // `p4` carries a LINEAR_TOKEN whose `metadata` was damaged by hand above: its origin, so which page
    // lists it, is unknown.
    const res = await app.request("/api/connections?projectId=p4");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    const linear = body.connections.find((c) => c.provider === PROVIDER.linear)!;

    assert.equal(linear.origin, null);
    assert.equal(
      linear.revokeUrl,
      null,
      "picking one would send people to where the token is not listed",
    );
  });
});

// Disconnect, which is not a revocation: Legion can only forget the token (revoking at GitHub needs app
// authentication, so a `client_secret` we do not ship). What this route must prove is narrow: it
// removes the right project's row, touches nothing else, and replays safely.
describe("DELETE /api/connections/:provider", () => {
  const forget = (provider: string, query: string) =>
    app.request(`/api/connections/${provider}/token${query}`, { method: "DELETE" });

  it("refuses an unknown provider, and a call without a project", async () => {
    assert.equal((await forget("bitbucket", "?projectId=p1")).status, 404);
    assert.equal((await forget(PROVIDER.github, "")).status, 400);
  });

  it("removes the provider's row, and nothing else", async () => {
    putSecret({ projectId: "p1", name: "GITHUB_TOKEN", value: "ghp_a_oublier" });
    putSecret({ projectId: "p1", name: "GITLAB_TOKEN", value: "glpat_qui_reste" });

    const res = await forget(PROVIDER.github, "?projectId=p1");

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { forgotten: true });
    assert.equal(secretRowFor("p1", "GITHUB_TOKEN"), null);
    assert.equal(
      freshSecret("p1", "GITLAB_TOKEN"),
      "glpat_qui_reste",
      "disconnecting one provider does not disconnect its neighbour",
    );
  });

  it("does not touch the same name on another project", async () => {
    putSecret({ projectId: "p1", name: "GITHUB_TOKEN", value: "ghp_p1" });
    putSecret({ projectId: "p4", name: "GITHUB_TOKEN", value: "ghp_p4" });

    await forget(PROVIDER.github, "?projectId=p1");

    assert.equal(secretRowFor("p1", "GITHUB_TOKEN"), null);
    assert.equal(freshSecret("p4", "GITHUB_TOKEN"), "ghp_p4");
  });

  it("replays safely: nothing to forget is not an error", async () => {
    await forget(PROVIDER.github, "?projectId=p1");

    const res = await forget(PROVIDER.github, "?projectId=p1");

    assert.equal(res.status, 200, "a 404 would fail the second click of a double click");
    assert.deepEqual(await res.json(), { forgotten: false });
  });
});

// A provider asking for something besides a token (the GitLab host in the product, an opaque value
// here). Checked: the route carries it without understanding it, reading a name from the descriptor,
// storing a string under it, and never inventing a value. The guard missing on 15/09, when the host
// lived in the environment and a probe went to `gitlab.com` for a framagit token.
describe("a provider asking for a field", () => {
  const TEST_FIELD = "test-field" as ProviderKind;
  const MISSING = "GitLab instance URL required";

  /** What the double saw on the last call. A variable rather than one provider per case: the registry
   *  is shared by the process. */
  let seen: { begun?: string; probed?: string; completed?: string } = {};

  /** The double's instance default, what `LEGION_GITLAB_HOST` is for GitLab.
   *
   *  Modelling it was necessary, and its absence let round 1 through: without a fallback,
   *  `unconfigured` always refused an emptied field, so `start`'s guard had no case of its own and the
   *  hole it closes was reachable by no test. A double simpler than the real provider only proves what
   *  it simulates. */
  let instanceDefault = "";

  registerProvider({
    kind: TEST_FIELD,
    secretName: "FIELD_TOKEN_TEST_ONLY",
    scopes: ["demandee"],
    field: () => ({
      name: "instance",
      label: "Instance URL",
      suggestion: "https://propose.test",
      missing: MISSING,
    }),
    // The configuration refusal judges what the provider will use: the received value, then its
    // instance default, as `declaredHost` does for GitLab. That is what makes `start`'s guard needed:
    // with a default set, this says "nothing missing" for a request that brought nothing to store.
    unconfigured: (field) => (field?.trim() || instanceDefault ? null : MISSING),
    revokeUrl: (_origin, field) => `${field ?? "rien"}/revoke`,
    adopt: async (_token, field) => {
      seen.probed = field;
      return { scopes: ["constatee"], account: "mona" };
    },
    begin: async ({ field }) => {
      seen.begun = field;
      return {
        kind: FLOW_KIND.device,
        userCode: "FIELD-1",
        verificationUri: "https://propose.test/device",
        intervalMs: 5000,
        expiresAt: Date.now() + 600_000,
        exchange: "dc_field",
      };
    },
    complete: async (_exchange, _arrived, field) => {
      seen.completed = field;
      return { status: FLOW_STATUS.connected, accessToken: "tok_field" };
    },
  });

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const metadataOf = (projectId: string) =>
    JSON.parse(secretRowFor(projectId, "FIELD_TOKEN_TEST_ONLY")?.metadata ?? "null") as Record<
      string,
      unknown
    > | null;

  it("the list declares the field and judges it on what the tile will suggest", async () => {
    const res = await app.request("/api/connections?projectId=p3");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    const mine = body.connections.find((c) => c.provider === TEST_FIELD)!;

    assert.deepEqual(mine.field, {
      label: "Instance URL",
      suggestion: "https://propose.test",
    });
    assert.equal(
      mine.unconfigured,
      null,
      "judging emptiness would show “instance missing” to someone whose tile will pre-fill it",
    );
  });

  it("`start` judges configuration on what the operator sent, and passes it on", async () => {
    seen = {};
    const refus = await post(`/api/connections/${TEST_FIELD}/start`, {
      projectId: "p1",
      field: "   ",
    });
    assert.equal(refus.status, 400);
    assert.equal(((await refus.json()) as { error: string }).error, MISSING);
    assert.equal(seen.begun, undefined, "an unconfigured provider opens no flow");

    const ok = await post(`/api/connections/${TEST_FIELD}/start`, {
      projectId: "p1",
      field: "https://pose.test",
    });
    assert.equal(ok.status, 200);
    assert.equal(seen.begun, "https://pose.test");
  });

  // The round 1 gap, the silent row this work exists to remove. With an instance default set,
  // `unconfigured` of an emptied field answers "nothing missing": the flow opened, `begin` and
  // `complete` agreed on the env host (no misdirected token), but `askedFields` stored nothing. The
  // granted credential no longer said which instance it talks to, adoption would never pick it up
  // (it has `metadata`), and its revocation link would fall back to a suggestion that can change.
  it("`start` refuses an emptied field even when an instance default exists", async () => {
    seen = {};
    instanceDefault = "https://defaut.test";
    try {
      const res = await post(`/api/connections/${TEST_FIELD}/start`, {
        projectId: "p3",
        field: "   ",
      });

      assert.equal(res.status, 400);
      assert.equal(
        ((await res.json()) as { error: string }).error,
        MISSING,
        "the refusal is the provider's, named, not a silence letting the flow open",
      );
      assert.equal(
        seen.begun,
        undefined,
        "a flow opened here would store a token without saying which instance it belongs to",
      );
    } finally {
      instanceDefault = "";
    }
  });

  // The other half of the guard: `unconfigured` keeps its branches. Without an instance default the
  // provider names what is missing; the guard before it would make that sentence unreachable, and with
  // it the case where two things are missing.
  it("without an instance default, the provider's sentence comes out", async () => {
    seen = {};
    const res = await post(`/api/connections/${TEST_FIELD}/start`, {
      projectId: "p3",
      field: "",
    });

    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, MISSING);
    assert.equal(seen.begun, undefined);
  });

  // And the proof on the real adapter, which has two things to ask for where the double has one.
  // Neither `LEGION_GITLAB_HOST` nor `LEGION_GITLAB_CLIENT_ID` is set in this file, so an empty field
  // reaches the branch where both are missing.
  //
  // This test justifies the order: the guard before `unconfigured` would make this sentence
  // unreachable, and the operator would learn one of the two gaps at a time, fixed in different places.
  it("the real GitLab states both causes when both are missing", async () => {
    const res = await post(`/api/connections/${PROVIDER.gitlab}/start`, {
      projectId: "p3",
      field: "",
    });

    assert.equal(res.status, 400);
    const refus = ((await res.json()) as { error: string }).error;
    assert.match(refus, /GitLab instance URL required/);
    assert.match(refus, /LEGION_GITLAB_CLIENT_ID required/);
  });

  it("the field travels with the flow to completion, and is stored in `metadata`", async () => {
    seen = {};
    const started = await post(`/api/connections/${TEST_FIELD}/start`, {
      projectId: "p3",
      field: "https://pose.test",
    });
    const { flowId } = (await started.json()) as { flowId: string };

    const polled = await post(`/api/connections/${TEST_FIELD}/poll`, { flowId });

    assert.equal(polled.status, 200);
    assert.equal(
      seen.completed,
      "https://pose.test",
      "rereading the environment to conclude would send the exchange secret to another instance",
    );
    assert.deepEqual(metadataOf("p3")?.fields, { instance: "https://pose.test" });
  });

  it("`adopt` refuses naming what is missing, without probing or writing", async () => {
    seen = {};
    const res = await post(`/api/connections/${TEST_FIELD}/adopt`, {
      projectId: "p4",
      token: "tok_colle",
    });

    assert.equal(res.status, 400);
    assert.equal(
      ((await res.json()) as { error: string }).error,
      MISSING,
      "“the provider did not recognise this token” about a provider nobody called is the lie this work paid for",
    );
    assert.equal(seen.probed, undefined, "no probing without knowing where to send");
    assert.equal(secretRowFor("p4", "FIELD_TOKEN_TEST_ONLY"), null);
  });

  it("`adopt` probes on the received value and stores it in clear next to the token", async () => {
    seen = {};
    const res = await post(`/api/connections/${TEST_FIELD}/adopt`, {
      projectId: "p4",
      token: "tok_colle",
      field: "https://framagit.test",
    });

    assert.equal(res.status, 200);
    assert.equal(seen.probed, "https://framagit.test");
    const metadata = metadataOf("p4");
    assert.deepEqual(metadata?.fields, { instance: "https://framagit.test" });
    assert.equal(
      JSON.stringify(metadata).includes("tok_colle"),
      false,
      "`metadata` is clear JSON: no secret ever enters it",
    );
  });

  it("the revocation page follows what the connection carries, not a default", async () => {
    const res = await app.request("/api/connections?projectId=p4");
    const body = (await res.json()) as { connections: Record<string, unknown>[] };
    const mine = body.connections.find((c) => c.provider === TEST_FIELD)!;

    assert.equal(mine.revokeUrl, "https://framagit.test/revoke");
  });
});

// Whose token it is, even when Legion ran the flow (round 5, 16/09). A pasted token goes through the
// probe and returns its account; a granted one did not, so `metadata.account` stayed empty and an OAuth
// connection's tile showed no account. The UI had the line; the data did not exist.
describe("a completed flow also asks whose token it is", () => {
  it("writes the account returned by the provider into the granted token's metadata", async () => {
    stubFetch([
      {
        device_code: "dc_compte",
        user_code: "ACCT-0001",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
      { access_token: "ghp_avec_compte", token_type: "bearer", scope: "repo" },
      // The third response is the `/user` probe's: `stubFetch` serves the last one indefinitely.
      { login: "ou-pas" },
    ]);
    const started = (await (
      await app.request("/api/connections/github/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p-account" }),
      })
    ).json()) as { flowId: string };

    await app.request("/api/connections/github/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flowId: started.flowId }),
    });

    const row = secretRowFor("p-account", "GITHUB_TOKEN");
    assert.ok(row, "the row exists");
    assert.equal((JSON.parse(row!.metadata!) as { account?: string }).account, "ou-pas");
    assert.equal(
      row!.metadata!.includes("ghp_avec_compte"),
      false,
      "the token must never appear in clear in metadata",
    );
  });

  // The probe is never fatal: a flow that just succeeded must not fail because a convenience call did
  // not answer. The account is then absent, as before: unknown is omitted, not invented.
  it("a provider silent about the account does not fail the flow", async () => {
    const realFetch = globalThis.fetch;
    let appels = 0;
    globalThis.fetch = (async () => {
      appels++;
      if (appels === 1)
        return new Response(
          JSON.stringify({
            device_code: "dc_muet",
            user_code: "MUET-0001",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (appels === 2)
        return new Response(JSON.stringify({ access_token: "ghp_muet", token_type: "bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error("the probe does not answer");
    }) as typeof fetch;
    try {
      const started = (await (
        await app.request("/api/connections/github/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: "p-silent" }),
        })
      ).json()) as { flowId: string };

      const res = await app.request("/api/connections/github/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId: started.flowId }),
      });

      assert.deepEqual(await res.json(), { status: FLOW_STATUS.connected });
      assert.equal(freshSecret("p-silent", "GITHUB_TOKEN"), "ghp_muet");
      const row = secretRowFor("p-silent", "GITHUB_TOKEN");
      assert.equal("account" in (JSON.parse(row!.metadata!) as object), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// The probe's timeout, and what it must never cost (round 6). A valid token is not lost because a
// convenience call timed out: the probe learns whose token it is, it does not decide whether it is
// stored.
describe("the account probe has a timeout, and cannot take the token with it", () => {
  it("leaves with an abort signal, and a timeout does not lose the token", async () => {
    const realFetch = globalThis.fetch;
    let appels = 0;
    let signalVu: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      appels++;
      if (appels === 1)
        return new Response(
          JSON.stringify({
            device_code: "dc_lent",
            user_code: "LENT-0001",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      if (appels === 2)
        return new Response(JSON.stringify({ access_token: "ghp_lent", token_type: "bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      // The third call is the probe. Observe its signal, then return what `AbortSignal.timeout`
      // produces when it fires, without waiting for the real delay.
      signalVu = init?.signal;
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }) as typeof fetch;
    try {
      const started = (await (
        await app.request("/api/connections/github/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: "p-slow" }),
        })
      ).json()) as { flowId: string };

      const res = await app.request("/api/connections/github/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ flowId: started.flowId }),
      });

      assert.ok(signalVu instanceof AbortSignal, "the probe leaves with an abort signal");
      assert.deepEqual(await res.json(), { status: FLOW_STATUS.connected });
      // The fact that matters: the token is stored and usable.
      assert.equal(freshSecret("p-slow", "GITHUB_TOKEN"), "ghp_lent");
      const metadata = JSON.parse(secretRowFor("p-slow", "GITHUB_TOKEN")!.metadata!) as Record<
        string,
        unknown
      >;
      assert.equal("account" in metadata, false, "unknown who it is, and not invented");
      // And `probedAt` stays absent: nobody was asked, so adoption still has to.
      assert.equal("probedAt" in metadata, false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
