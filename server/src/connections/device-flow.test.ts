// The shared base of both device grants (RFC 8628), tested for itself. Its functions were only
// exercised through `github-device.ts` and `gitlab-device.ts`; `optionalNumber` was covered on two of
// its five inputs.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

process.env.LEGION_MASTER_KEY ??= "0".repeat(64);

const { optionalNumber, postForm, required, translateDeviceError } =
  await import("./device-flow.js");
const { ARRIVED_KIND, FLOW_KIND, FLOW_STATUS, FLOW_STATUSES, PROVIDERS, ProviderRefusal } =
  await import("./providers.js");

// The serialised contract with the UI, pinned once. Correction round 1 replaced enum literals with
// constants (`status: FLOW_STATUS.slowDown`), removing the last place proving the serialised string
// rather than the constant compared to itself. No compiler reads this string back:
// `web/src/api/connections.ts` hard-codes it, and `make contract` compares route paths, not payloads.
// These `deepEqual`s are the only thing that breaks if someone changes a value.
describe("the serialised contract with the UI", () => {
  it("PROVIDERS serialises exactly the three names web/src/api/connections.ts expects", () => {
    assert.deepEqual(PROVIDERS, ["github", "gitlab", "linear"]);
  });

  it("FLOW_KIND serialises exactly the two families web/src/api/connections.ts expects", () => {
    assert.deepEqual(FLOW_KIND, { device: "device", redirect: "redirect" });
  });

  it("FLOW_STATUSES serialises exactly the five statuses web/src/api/connections.ts expects", () => {
    assert.deepEqual(FLOW_STATUSES, ["pending", "connected", "denied", "expired", "slow_down"]);
  });

  it("ARRIVED_KIND serialises poll/code: it does not cross HTTP, but is worth pinning", () => {
    assert.deepEqual(ARRIVED_KIND, { poll: "poll", code: "code" });
  });
});

describe("optionalNumber", () => {
  it("falls back to the default on an empty string", () => {
    assert.equal(optionalNumber({ interval: "" }, "interval", 5), 5);
  });

  it("falls back to the default when the field is missing", () => {
    assert.equal(optionalNumber({}, "interval", 5), 5);
  });

  it("falls back to the default on a whitespace string (the `.trim()`)", () => {
    assert.equal(optionalNumber({ interval: "   " }, "interval", 5), 5);
  });

  it("falls back to the default on a non-numeric value (NaN)", () => {
    assert.equal(optionalNumber({ interval: "not-a-number" }, "interval", 5), 5);
  });

  it("falls back to the default on a negative value", () => {
    assert.equal(optionalNumber({ interval: "-5" }, "interval", 5), 5);
  });

  it("falls back to the default on zero (value > 0, not value >= 0)", () => {
    assert.equal(optionalNumber({ interval: "0" }, "interval", 5), 5);
  });

  // The case that really exercises `Number.isFinite`: `NaN > 0` is already false, but
  // `Infinity > 0` is true, so only `Number.isFinite(Infinity) === false` falls back here.
  it("falls back to the default on Infinity (the real test of `Number.isFinite`)", () => {
    assert.equal(optionalNumber({ interval: "Infinity" }, "interval", 5), 5);
  });

  it("returns the value for a valid positive number", () => {
    assert.equal(optionalNumber({ interval: "12" }, "interval", 5), 12);
  });
});

describe("required", () => {
  it("returns the value when the field is present", () => {
    assert.equal(required({ user_code: "ABCD" }, "user_code", "GitHub"), "ABCD");
  });

  it("throws a named error when the field is missing", () => {
    assert.throws(() => required({}, "user_code", "GitHub"), /GitHub answered without user_code/);
  });
});

describe("translateDeviceError: the RFC 8628 table", () => {
  const refusal = (error: string) => `refusal: ${error}`;

  it("translates authorization_pending to pending", () => {
    assert.equal(translateDeviceError("authorization_pending", refusal), FLOW_STATUS.pending);
  });

  it("translates slow_down to slowDown", () => {
    assert.equal(translateDeviceError("slow_down", refusal), FLOW_STATUS.slowDown);
  });

  it("translates expired_token to expired", () => {
    assert.equal(translateDeviceError("expired_token", refusal), FLOW_STATUS.expired);
  });

  it("translates access_denied to denied", () => {
    assert.equal(translateDeviceError("access_denied", refusal), FLOW_STATUS.denied);
  });

  it("throws a terminal refusal with the caller's message for a non-RFC code", () => {
    assert.throws(
      () => translateDeviceError("unauthorized_client", refusal),
      (err: unknown) =>
        err instanceof ProviderRefusal && (err as Error).message === "refusal: unauthorized_client",
    );
  });
});

describe("postForm", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("posts form-urlencoded and returns the response JSON", async () => {
    const seen: { url: string; body: string; contentType: string | null }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({
        url: String(url),
        body: String(init?.body ?? ""),
        contentType: new Headers(init?.headers).get("content-type"),
      });
      return new Response(JSON.stringify({ ok: "true" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const body = await postForm("Test", "https://example.test/token", { a: "1" });

    assert.deepEqual(body, { ok: "true" });
    assert.equal(seen[0]!.url, "https://example.test/token");
    assert.equal(seen[0]!.contentType, "application/x-www-form-urlencoded");
    assert.equal(seen[0]!.body, "a=1");
  });

  // The type matters as much as the message (see comment B of `github-device.test.ts`): `routes.ts`
  // branches on `instanceof ProviderRefusal` to tell a terminal refusal (closes the flow) from a
  // transport incident (answers pending). A message regex alone would let an implementation wrongly
  // throw `ProviderRefusal` here, since it extends `Error`.
  it("throws a named transport error, not a ProviderRefusal, when the response is not ok", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;

    await assert.rejects(
      () => postForm("Test", "https://example.test/token", {}),
      (err: unknown) =>
        err instanceof Error &&
        !(err instanceof ProviderRefusal) &&
        /Test answered 502 on https:\/\/example\.test\/token/.test(err.message),
    );
  });
});
