//  1. an id (or its resolved alias) known to `listModels()` is "listed" WITHOUT the network: the
//     most frequent case must stay immediate;
//  2. otherwise an API key decides through the real API: 200 → "exists", 404 → "unknown";
//  3. without an API key (OAuth only, or none): "unverifiable", no network;
//  4. a timeout or network error is "unverifiable", never an exception that would block saving;
//  5. results are cached 6 h per id.
// All dependencies are injected: no test touches the real SDK, a database or the network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearProbeCache,
  isListed,
  probeModel,
  type ProbeDeps,
  type ProbeResult,
} from "./models-probe.js";

const MODELS = [
  { id: "opus", resolves: "claude-opus-5" },
  { id: "claude-haiku-4-5", resolves: null },
];

function deps(overrides: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    listModels: async () => ({ models: MODELS }),
    credentialEnvFor: () => ({ env: {} }),
    fetch: (() => {
      throw new Error("fetch should not be called in this test");
    }) as unknown as typeof fetch,
    timeoutMs: 3000,
    ...overrides,
  };
}

describe("isListed", () => {
  it("recognises a direct id", () => {
    assert.equal(isListed("claude-haiku-4-5", MODELS), true);
  });

  it("recognises an id reached by resolving an alias", () => {
    assert.equal(isListed("claude-opus-5", MODELS), true);
  });

  it("returns false for an id that is really absent", () => {
    assert.equal(isListed("claude-opus-9-9", MODELS), false);
  });
});

describe("probeModel", () => {
  it('"listed": no network call when the SDK already knows the id', async () => {
    clearProbeCache();
    const result = await probeModel("claude-haiku-4-5", undefined, deps());
    assert.deepEqual(result, { verdict: "listed" });
  });

  it('"listed" through a resolved alias, not only the raw id', async () => {
    clearProbeCache();
    const result = await probeModel("claude-opus-5", undefined, deps());
    assert.equal(result.verdict, "listed");
  });

  it('"unverifiable" without an API key, no network call', async () => {
    clearProbeCache();
    const result = await probeModel(
      "claude-opus-9-9",
      undefined,
      deps({ credentialEnvFor: () => ({ env: {} }) }),
    );
    assert.equal(result.verdict, "unverifiable");
    assert.match(result.detail ?? "", /no API key/);
  });

  it('ignores a lone OAuth token: "unverifiable", no probe, credentialEnvFor returns ONLY the winner', async () => {
    clearProbeCache();
    // `credentialEnvFor` already hides losing credentials (auth.ts): an OAuth project never
    // returns ANTHROPIC_API_KEY, even if the control plane has one.
    const result = await probeModel(
      "claude-opus-9-9",
      "p1",
      deps({ credentialEnvFor: () => ({ env: { CLAUDE_CODE_OAUTH_TOKEN: "tok-secret" } }) }),
    );
    assert.equal(result.verdict, "unverifiable");
  });

  it('"exists" when the API answers 200', async () => {
    clearProbeCache();
    let calledUrl = "";
    let calledHeaders: Record<string, string> = {};
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calledUrl = String(url);
      calledHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const result = await probeModel(
      "claude-opus-4-8",
      undefined,
      deps({
        credentialEnvFor: () => ({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
        fetch: fakeFetch,
      }),
    );
    assert.deepEqual(result, { verdict: "exists" });
    assert.equal(calledUrl, "https://api.anthropic.com/v1/models/claude-opus-4-8");
    assert.equal(calledHeaders["x-api-key"], "sk-test", "never send an OAuth token to the probe");
  });

  it('"unknown" when the API answers 404, with its message as detail', async () => {
    clearProbeCache();
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: "model: claude-opus-9-9" } }), {
        status: 404,
      })) as unknown as typeof fetch;
    const result = await probeModel(
      "claude-opus-9-9",
      undefined,
      deps({
        credentialEnvFor: () => ({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
        fetch: fakeFetch,
      }),
    );
    assert.equal(result.verdict, "unknown");
    assert.equal(result.detail, "model: claude-opus-9-9");
  });

  it('"unverifiable" on a network error, never throws', async () => {
    clearProbeCache();
    const fakeFetch = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const result = await probeModel(
      "claude-opus-9-9",
      undefined,
      deps({
        credentialEnvFor: () => ({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
        fetch: fakeFetch,
      }),
    );
    assert.equal(result.verdict, "unverifiable");
    assert.match(result.detail ?? "", /ENOTFOUND/);
  });

  it('"unverifiable" when the probe times out: the timeout is wired to the signal', async () => {
    clearProbeCache();
    const fakeFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })) as unknown as typeof fetch;
    const result = await probeModel(
      "claude-opus-9-9",
      undefined,
      deps({
        credentialEnvFor: () => ({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
        fetch: fakeFetch,
        timeoutMs: 20,
      }),
    );
    assert.equal(result.verdict, "unverifiable");
    assert.match(result.detail ?? "", /timed out/);
  });

  it("unexpected answer (neither 200 nor 404): unverifiable, not an exception", async () => {
    clearProbeCache();
    const fakeFetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const result = await probeModel(
      "claude-opus-9-9",
      undefined,
      deps({
        credentialEnvFor: () => ({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
        fetch: fakeFetch,
      }),
    );
    assert.equal(result.verdict, "unverifiable");
  });

  it("caches 6 h per id: the second call reads neither the list nor the network", async () => {
    clearProbeCache();
    let listCalls = 0;
    let fetchCalls = 0;
    const d = deps({
      listModels: async () => {
        listCalls++;
        return { models: [] };
      },
      credentialEnvFor: () => ({ env: { ANTHROPIC_API_KEY: "sk-test" } }),
      fetch: (async () => {
        fetchCalls++;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    const first: ProbeResult = await probeModel("claude-opus-9-9", undefined, d);
    const second: ProbeResult = await probeModel("claude-opus-9-9", undefined, d);
    assert.deepEqual(first, second);
    assert.equal(listCalls, 1, "the list must be read only once");
    assert.equal(fetchCalls, 1, "the network must be hit only once");
  });

  it("empty id: immediately unverifiable, touching neither the list nor the network", async () => {
    clearProbeCache();
    const result = await probeModel("   ", undefined, deps());
    assert.equal(result.verdict, "unverifiable");
  });
});
