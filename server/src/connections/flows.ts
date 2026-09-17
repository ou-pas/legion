// OAuth flows in progress, in memory.
//
// A flow lives a few minutes; a table would need cleanup and buy nothing. A server restart mid-flow
// is harmless: the entry vanishes, polling answers "expired", the operator clicks again.
//
// The exchange secret never leaves. At GitHub it is the `device_code`, which is what trades for an
// access token; the browser only receives an opaque `flowId`, worthless outside this process.
import { randomBytes } from "node:crypto";
import type { ProviderKind } from "./providers.js";

export type Flow = {
  provider: ProviderKind;
  projectId: string;
  /** The provider's exchange secret. Never crosses the HTTP boundary.
   *
   *  Named by role, not shape, since its content depends on the family: the `device_code` for a
   *  device grant (traded for an access token), the PKCE `code_verifier` for a redirect flow (proving
   *  to the provider that the `code` returned by the browser is ours). Known to the browser, either
   *  would void the guarantee, hence the same treatment. */
  exchange: string;
  expiresAt: number;
  /** The OAuth `state` of a redirect flow: its only handle on return. The browser coming back from
   *  the provider does not carry the `flowId`, it carries what we put in the authorisation URL.
   *
   *  Absent for a device grant, which has no browser return. Optional rather than empty: "this flow
   *  does not come back that way" and "it comes back with an empty state" are different facts. */
  state?: string;
  /** What the provider asked for to open this flow (the instance host for GitLab).
   *
   *  It travels with the flow because it decides where the exchange secret is exchanged: `begin`
   *  opened the device flow on one instance, and its `device_code` is only valid there. Reading it
   *  from the environment at completion would send one instance's secret to another, the same fault
   *  as polling a `flowId` under another provider's name (comment A).
   *
   *  Absent for providers that ask for nothing (two out of three). */
  field?: string;
};

const flows = new Map<string, Flow>();

/** Purges expired flows. Called on open, not only on read: a flow started and never polled (tab
 *  closed, operator giving up) is never read, so `readFlow` alone would never clean it. The next flow
 *  opened, by anyone, sweeps whatever expired meanwhile. */
function sweepExpired(): void {
  const now = Date.now();
  for (const [id, flow] of flows) {
    if (flow.expiresAt <= now) flows.delete(id);
  }
}

export function openFlow(flow: Flow): string {
  sweepExpired();
  const id = randomBytes(16).toString("base64url");
  flows.set(id, flow);
  return id;
}

/** The flow, if it still exists, is not expired, and belongs to `provider`.
 *
 *  A: the owner is an argument, not a check a caller can forget. A `flowId` is opaque but does not
 *  say whose it is; `flow.provider` knows, and was written at open then read nowhere. Without the
 *  check, `POST /api/connections/gitlab/poll { flowId: <a github flow> }` posted GitHub's
 *  `device_code` to `gitlab.com/oauth/token` (one service's secret sent to another), and any token
 *  out of it would have landed under `GITLAB_TOKEN` with GitLab scopes in its `metadata`. The hole
 *  was unreachable while only one device provider existed. In the signature rather than the route,
 *  a flow cannot be read without saying whose it is believed to be.
 *
 *  Another provider's flow is indistinguishable from an unknown one, on purpose: a probing caller
 *  learns nothing. It is not deleted either, so its legitimate owner can still poll it.
 *
 *  An expired flow read here is deleted in passing, but `sweepExpired` on open is what keeps the map
 *  bounded, since a never-read flow never passes here. */
export function readFlow(id: string, provider: ProviderKind): Flow | null {
  const flow = flows.get(id);
  if (!flow) return null;
  if (flow.expiresAt <= Date.now()) {
    flows.delete(id);
    return null;
  }
  if (flow.provider !== provider) return null;
  return flow;
}

/** The flow a `state` designates, consumed in passing: the whole guard of an unauthenticated request
 *  that writes a secret.
 *
 *  Single use. The callback is a `GET`, which `mutationOriginGuard` does not cover (and cannot: the
 *  browser arrives from the provider with its `Origin`). What remains is this `state`, so it must be
 *  worth one use: found, it disappears whether the exchange succeeds or fails. A replay finds
 *  nothing, and an intercepted `code` is not exchanged twice. A failed exchange costs the operator
 *  one more click; that is the right side of the balance.
 *
 *  The provider is an argument for the same reason as `readFlow` (comment A): the callback is unique
 *  for the whole redirect family, so nothing in its path says whose return it is. The `state` prefix
 *  designates the adapter; this check verifies the flow really belongs to it, or a Linear `code`
 *  would be exchanged for a token stored under another provider's name.
 *
 *  A mismatching provider does not consume the flow: that is a forgery, and consuming would let a
 *  third party cancel a legitimate flow by claiming it for another provider.
 *
 *  A linear scan: the map holds one operator's live flows, a handful. */
export function claimFlowByState(state: string, provider: ProviderKind): Flow | null {
  for (const [id, flow] of flows) {
    if (flow.state !== state) continue;
    if (flow.provider !== provider) return null;
    flows.delete(id);
    return flow.expiresAt <= Date.now() ? null : flow;
  }
  return null;
}

export function closeFlow(id: string): void {
  flows.delete(id);
}

/** Number of flows held in memory, expired included until swept. Only used by `flows.test.ts` to
 *  prove `sweepExpired` works. */
export function flowCount(): number {
  return flows.size;
}
