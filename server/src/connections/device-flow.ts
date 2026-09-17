// What device grants (RFC 8628) and the adoption probes share, and nothing more.
//
// GitHub and GitLab implement the same RFC: two endpoints, form-urlencoded requests, 200 responses
// carrying an `error` field, and four error codes whose meaning the RFC fixes. What separates them is
// the host, the client id and their proprietary refusals, not the translation table. A copied table
// diverges: two copies mean a fix applied half the time.
//
// The file name is narrower than its content: Linear borrows `postForm`, `required` and `probe`
// without doing a device grant (see the header of `linear-redirect.ts`).
import { FLOW_STATUS, ProviderRefusal, type FlowStatus } from "./providers.js";

/** The four responses that matter and what they mean for us. They are 200s with an `error` field,
 *  not HTTP codes. `authorization_pending` is the normal case (the operator has not typed the code
 *  yet); treating it as a failure would abandon a flow about to succeed. */
const RFC_8628: Readonly<Record<string, FlowStatus>> = {
  authorization_pending: FLOW_STATUS.pending,
  slow_down: FLOW_STATUS.slowDown,
  expired_token: FLOW_STATUS.expired,
  access_denied: FLOW_STATUS.denied,
};

/** Translates the `error` field of a device grant response.
 *
 *  `refusal` is the adapter-specific part: the message when the code is not one of the RFC's four.
 *  Such a code is a terminal refusal (`ProviderRefusal`): polling would never succeed, so `routes.ts`
 *  must close the flow. */
export function translateDeviceError(
  error: string,
  refusal: (error: string) => string,
): FlowStatus {
  const status = RFC_8628[error];
  if (status) return status;
  throw new ProviderRefusal(refusal(error));
}

/** Form-urlencoded POST, JSON response: what both providers document for their device flow
 *  endpoints. A test double accepting any body would never have revealed it. */
export async function postForm(
  label: string,
  url: string,
  body: Record<string, string>,
): Promise<Record<string, string>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
  });
  // `!res.ok` is a transport incident (provider 5xx): an ordinary `Error`, not `ProviderRefusal`,
  // since the exchange secret may still be valid. The URL stays in the message because it goes to
  // the log, never to the client (`routes.ts` does not return exception messages, see comment M).
  if (!res.ok) throw new Error(`${label} answered ${res.status} on ${url}`);
  return (await res.json()) as Record<string, string>;
}

/** A response saying "not now" rather than "not you".
 *
 *  GitHub answers 403 on quota exhaustion with a perfectly valid token, not only 429. Without this the
 *  operator would read "GitHub did not recognise this token" and look for another when waiting was
 *  enough (the same defect fixed for Linear: a 429 is not a refusal).
 *
 *  Both headers: `x-ratelimit-remaining: 0` is GitHub's primary limit, `retry-after` comes with its
 *  secondary limits and most other providers. A 403 with neither stays a refusal, which preserves the
 *  GitLab case: `/personal_access_tokens/self` answers a bare 403 to a token not allowed to read its
 *  own scopes, which the adapter reads as "scopes unknown". */
function rateLimited(res: Response): boolean {
  return res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after");
}

/** A probe's timeout: a domain constant, since all three adapters go through `probe`.
 *
 *  Why (round 6): `undici` allows 300 s of `headersTimeout` by default, so a probe behind a `poll` the
 *  UI waits for could hang the screen five minutes on a slow provider. The probe is a convenience
 *  (learning whose token it is) and must not hold back a connection that already succeeded.
 *
 *  Here rather than in `integrations/`: `withForgeTimeout` lives there, but importing `integrations`
 *  from `connections` would open a domain edge `make arch` refuses, for three lines. Five seconds, as
 *  elsewhere. */
export const PROBE_TIMEOUT_MS = 5_000;

/** Hands a token to the provider and looks at what it says: the shared mechanics of adoption probes.
 *
 *  Three outcomes, and the split is what matters: the response (token recognised), `null` (refused, a
 *  fact to show), or an `Error` (quota, 5xx, network: a transport incident from which the route must
 *  conclude and write nothing). Copying this split into each adapter is how a provider ends up storing
 *  a token on an outage, or refusing a valid one on a 503.
 *
 *  The whole response rather than its body: GitHub puts a PAT's scopes in a header. */
export async function probe(
  label: string,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  // The timeout covers both paths at once, since `probe` is the single funnel of the three `adopt`s:
  // the pasted token being probed, and the granted token whose account is asked at the end of its
  // flow. A caller bringing its own signal keeps it.
  const res = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (res.status === 401) return null;
  if (res.status === 403 && !rateLimited(res)) return null;
  // The URL stays in the message because it goes to the log, never the client. The token never does:
  // it travels in an `init` header nothing here reads.
  if (!res.ok) throw new Error(`${label} answered ${res.status} on ${url}`);
  return res;
}

/** A field the RFC makes mandatory, read as such. A complacent `!` would assert a remote server always
 *  keeps its word; here a missing field becomes a named `Error`, a transport incident the operator can
 *  retry, not `userCode: undefined` on screen. */
export function required(payload: Record<string, string>, field: string, label: string): string {
  const value = payload[field];
  if (!value) throw new Error(`${label} answered without ${field}`);
  return value;
}

/** An optional field, read as a string or not at all: the twin of `required`.
 *
 *  `postForm` types its return as `Record<string, string>` by assertion (a cast `res.json()`). A
 *  provider returning a numeric or object `refresh_token` would carry it to `encryptSecret`, which
 *  would store an unreadable secret, discovered only at the first renewal. Absent and wrongly typed
 *  are handled alike: neither can be used. */
export function optionalString(payload: Record<string, string>, field: string): string | undefined {
  const value = payload[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** D: an optional number from the response, with its default. `Number(r.interval ?? 5)` is not
 *  enough: `??` only catches `undefined`, and `Number("")` is zero. An `interval: ""` would hammer the
 *  provider, an `expires_in: ""` would close the flow as it opens. Non-finite or negative values fall
 *  back too: guessing wrong is worse than the RFC's recommended value. */
export function optionalNumber(
  payload: Record<string, string>,
  field: string,
  fallback: number,
): number {
  const raw = payload[field];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
