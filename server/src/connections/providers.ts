// What a provider is for the connections domain, and nothing more: how to open an authorisation
// flow, how to finish it, and under which secret name the obtained token is stored.
//
// The secret name is the point of the whole effort. `GITHUB_TOKEN` is the one `forge.ts` already
// knows: writing there means HTTPS clone, PR diffs, webhooks and update checks work the second the
// flow ends, without changing a line in those domains.
//
// The `clientId` is not a secret. It is public by design (it travels in the authorisation URL), so it
// is committed, and the environment can override it: someone running their own instance registers
// their own app rather than authorising ours.
//
// This port holds two OAuth families. Its first version was `start()`/`poll()`, which is the device
// grant's shape with GitHub inside. The families differ on the deepest question between grants: how
// the authorisation comes back. Through our polling for a device grant; through a browser redirect
// to our callback for authorisation code + PKCE. Forcing the second into `poll` would have meant
// optional fields everywhere, or a `poll` that throws.

import { randomBytes } from "node:crypto";

export const PROVIDER = { github: "github", gitlab: "gitlab", linear: "linear" } as const;
export const PROVIDERS = [PROVIDER.github, PROVIDER.gitlab, PROVIDER.linear] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

/** How the authorisation comes back.
 *
 *  No tuple or derived type, unlike `FLOW_STATUS`: `kind` is the discriminant of `BeginResult`, so a
 *  `FlowKind` union would have no reader, and `make deadcode` would count it as debt (mirror of
 *  `web/src/api/connections.ts`). */
export const FLOW_KIND = { device: "device", redirect: "redirect" } as const;

/** What a flow returns when it starts: a union, because the two OAuth families differ where it
 *  matters.
 *
 *  `device`: authorisation comes back through our polling. The operator types a code at the provider,
 *  on any device. There is no redirect (RFC 8628), so no URL to register.
 *
 *  `redirect`: it comes back through the browser, returning to us with a `code`. That requires a
 *  callback route and a single-use `state`.
 *
 *  A union, not optional fields: a `userCode?` on a redirect flow would be a lying field. */
export type BeginResult =
  | {
      kind: typeof FLOW_KIND.device;
      userCode: string;
      verificationUri: string;
      intervalMs: number;
      expiresAt: number;
    }
  | {
      kind: typeof FLOW_KIND.redirect;
      authorizeUrl: string;
      expiresAt: number;
    };

/** Same reasoning as `FLOW_KIND`: `kind` is the discriminant of `Arrived`. */
export const ARRIVED_KIND = { poll: "poll", code: "code" } as const;

/** What arrives from outside to finish a flow: nothing for a device grant (we ask again), the
 *  callback `code` for a redirect. */
export type Arrived =
  | { kind: typeof ARRIVED_KIND.poll }
  | { kind: typeof ARRIVED_KIND.code; code: string };

/** Where a token comes from, which is not the same question as "can it be renewed".
 *
 *  The two were conflated while `metadata` could only come from a connection. A pasted token now also
 *  carries `metadata` (its probed scopes), so the shortcut is wrong, and it already was the other way:
 *  a GitHub connection has no refresh token ("Expire user access tokens" unchecked) yet claimed to be
 *  renewable.
 *
 *  `granted`: the provider granted it to Legion at the end of an authorisation flow.
 *  `pasted`: the operator pasted it; the provider does not know Legion exists.
 *
 *  A token can come from a connection without being renewable; it cannot be renewable without coming
 *  from one. */
export const TOKEN_ORIGIN = { granted: "granted", pasted: "pasted" } as const;
export const TOKEN_ORIGINS = [TOKEN_ORIGIN.granted, TOKEN_ORIGIN.pasted] as const;
export type TokenOrigin = (typeof TOKEN_ORIGINS)[number];

/** How a token is presented in `Authorization`: an observed fact, not a convention inferred from the
 *  secret name.
 *
 *  `bearer`: `Authorization: Bearer <token>`. `raw`: the token alone.
 *
 *  Why it is stored: the name `LINEAR_TOKEN` carried that convention by itself, true of an OAuth token
 *  and false of a personal key. The probe in `linear-redirect.ts` accepts both and tries raw first, so
 *  a personal key passed adoption and was then sent as `Bearer` by `integrations/linear.ts`. The UI
 *  said "connected" and every GraphQL request failed. What the probe finds, `metadata` stores, and the
 *  reader reads back.
 *
 *  Absent means `bearer`, not as a guess: it is the format of tokens obtained through an authorisation
 *  flow, so of every row written before this field existed. */
export const AUTH_FORMAT = { bearer: "bearer", raw: "raw" } as const;
export const AUTH_FORMATS = [AUTH_FORMAT.bearer, AUTH_FORMAT.raw] as const;
export type AuthFormat = (typeof AUTH_FORMATS)[number];

/** The `Authorization` header value, in the format observed at acquisition.
 *
 *  The only place deciding the prefix for calls Legion makes itself. A second chain exists and does
 *  not go through here: `${SECRET:NAME}` (`capabilities/capabilities.ts`, `resolveSecretRefs`)
 *  substitutes a secret's value into a hand-written configuration (MCP server headers, container
 *  variables). It has no access to `metadata.authFormat`, only a name, and the configuration author
 *  writes `Bearer ` in front, with the same defect `integrations/linear.ts` had before 15/09.
 *
 *  The demo template (`projects/seed/demo.ts`) had its header removed for that reason rather than
 *  fixed. Carrying the format into `${SECRET:…}` is separate work; until then, "one place decides the
 *  prefix" is not true. */
export function authorizationHeader(token: string, format: AuthFormat | undefined): string {
  return format === AUTH_FORMAT.raw ? token : `Bearer ${token}`;
}

/** Where a flow stands. `slowDown` is a provider answer, not an error: it asks to space polling, and
 *  the UI must obey rather than hammer. Key is the concept (`slowDown`), value what the provider
 *  serialises (`"slow_down"`). */
export const FLOW_STATUS = {
  pending: "pending",
  connected: "connected",
  denied: "denied",
  expired: "expired",
  slowDown: "slow_down",
} as const;
export const FLOW_STATUSES = [
  FLOW_STATUS.pending,
  FLOW_STATUS.connected,
  FLOW_STATUS.denied,
  FLOW_STATUS.expired,
  FLOW_STATUS.slowDown,
] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

/** What a provider asks for besides the token: declared by it, carried by everyone else. The route
 *  and the tile do not know what the value means; they read a label, carry a string, and store it
 *  under the key the descriptor named.
 *
 *  Why the port had to learn this (15/09, first real call): `adopt(token)` got only a token and
 *  `begin(ctx)` only a project, so the GitLab host had no path to the adapter and lived in
 *  `LEGION_GITLAB_HOST`, global to the instance. But a GitLab OAuth app is registered per GitLab
 *  instance and a token belongs to one: the probe refused a valid framagit token by asking
 *  `gitlab.com`, and the message blamed the token. The host is a property of the connection.
 *
 *  No secret goes through here: the value is stored in `metadata`, which is clear JSON, so what is
 *  declared is public by construction (an instance URL, an app id).
 *
 *  One field, a deliberate ceiling: one extra value for one provider out of three, and
 *  `ui/connect-tile.tsx` renders one field. An array would turn the tile into a form layout. */
export type ProviderField = {
  /** Key under `metadata.fields`, named and read back by the provider alone. */
  name: string;
  /** The field label on screen. */
  label: string;
  /** What the tile pre-fills, so what the operator sees before sending and what goes if untouched.
   *  Not a hidden guess: a guess that showed nowhere is exactly what just cost a diagnosis. */
  suggestion: string;
  /** The answer when the value is missing, written by the provider, which alone knows what it is. */
  missing: string;
};

export type ConnectionProvider = {
  kind: ProviderKind;
  /** The name under which the obtained token is stored in `secrets`. */
  secretName: string;
  /** What this provider asks for besides the token, or nothing. A function rather than a constant,
   *  like `unconfigured`: the result depends on the environment (the suggestion reuses the instance
   *  default), and a value frozen at module load would not be testable. */
  field?: () => ProviderField;
  /** Requested scopes. The single source: `routes.ts` is provider-agnostic and reads them here, so
   *  they are not kept in sync in two places. */
  scopes: readonly string[];
  /** What is missing for this provider to be usable, in one sentence for the operator. `null` if
   *  nothing.
   *
   *  It used to be a boolean and the route wrote the sentence, asserting a configuration fact it does
   *  not own. Fine while all three providers lacked the same thing (a client id), wrong as soon as one
   *  lacks something else: Linear also needs the instance's public URL.
   *
   *  The sentence carries what to copy when there is something to copy, such as the redirect URL to
   *  register at the provider. It goes as is to the UI toast: a configuration refusal, not an exception
   *  message (`routes.ts` lets none out, see its comment M).
   *
   *  The field value is an argument (15/09): what is missing can be what the operator types. GitLab
   *  can lack its host, its client id, or both, fixed in two different places, which one sentence
   *  ("no gitlab app declared") sent all to the wrong one. */
  unconfigured: (field: string | undefined) => string | null;
  /** Where the operator revokes for good, at the provider.
   *
   *  Legion cannot revoke (checked in GitHub docs on 15/09): `DELETE /applications/{client_id}/token`
   *  needs app authentication, so a `client_secret`, and we ship none, which is what makes
   *  `client_id` public. Disconnecting forgets the token on Legion's side; it stays valid at the
   *  provider. The UI must say so and where to go.
   *
   *  Origin is an argument (round 1 fix). GitHub and GitLab revoke an OAuth grant and a personal token
   *  on two different pages. A pasted token is almost always personal: the authorised apps page does
   *  not list it, and a link to a page where the token does not appear is worse than no link.
   *
   *  A function also because a self-hosted GitLab does not revoke on `gitlab.com`.
   *
   *  The caller does not call it when the origin is unknown (`origin` null, unreadable `metadata`):
   *  there is no page to point to, and omitting the link is the only answer that invents nothing. */
  revokeUrl: (origin: TokenOrigin, field: string | undefined) => string;
  /** Opens a flow, also returning the exchange secret kept server-side.
   *
   *  `ctx` carries the project, since a connection is made on a project, and the declared field value
   *  when the provider asks for one.
   *
   *  No `flowId` here: Legion-side tracking is set by `flows.ts`, which alone knows what an opaque id
   *  is. An adapter returning an empty `flowId` would leave every reader wondering which one counts. */
  begin: (ctx: {
    projectId: string;
    field: string | undefined;
  }) => Promise<BeginResult & { exchange: string }>;
  /** What is learned about a pasted token by asking the provider. `null` when the token is refused: a
   *  refusal to show, not an exception. A transport incident (5xx, network) throws an ordinary `Error`
   *  as elsewhere in this port; the route turns it into "retry" and writes nothing.
   *
   *  Optional: a provider that cannot probe stays usable, and the token is stored without asserting
   *  anything about its scopes. Never make up a list the provider did not confirm: lying `metadata` is
   *  worse than none, since the UI shows it as fact. */
  adopt?: (token: string, field: string | undefined) => Promise<Adopted | null>;
  /** Finishes a flow or says where it stands. `exchange` is the server-kept secret: the `device_code`
   *  for a device grant, the PKCE `code_verifier` for a redirect.
   *
   *  An adapter refuses the other family by name: a device grant never receives a `code`, a redirect
   *  flow is not polled. */
  complete: (exchange: string, arrived: Arrived, field: string | undefined) => Promise<Completion>;
};

/** What a probe observes about a pasted token.
 *
 *  Both fields are nullable separately: a GitHub fine-grained PAT returns no scopes header, so the
 *  account is known and the scopes are not. `scopes: []` would say "this token may do nothing", which
 *  is false; `null` says "unknown", the only fact available. */
export type Adopted = {
  scopes: readonly string[] | null;
  account: string | null;
  /** The header format under which the probe got its answer. Absent when the provider reads tokens
   *  one way only (`bearer` default). Present for Linear, the only one accepting both. */
  authFormat?: AuthFormat;
};

/** What a finished flow returns. `{ status, accessToken }` was enough for both device grants, whose
 *  tokens do not expire. Linear returns a 24-hour token with a `refresh_token`, and both must reach
 *  `putSecret` (one encrypted in `refresh_ciphertext`, the expiry in clear in `metadata`). A separate
 *  channel would have given two paths for one flow conclusion.
 *
 *  Both fields stay optional: "no renewal" and "no known expiry" are the normal state of a device
 *  grant, not missing values. */
export type Completion = {
  status: FlowStatus;
  accessToken?: string;
  /** The refresh token, in clear. `putSecret` encrypts it; nothing here does. */
  refreshToken?: string;
  /** Epoch milliseconds. Absent means no known expiry, which is not "never expires". */
  expiresAt?: number;
};

/** The redirect family's `state` format: `<provider>.<secret>`. These two functions are the two halves
 *  of one convention (the adapter mints it, the route reads it back) and live side by side because,
 *  apart, they drift: `mintState` used to be in `linear-redirect.ts` and `splitState` in `routes.ts`.
 *
 *  Why a prefix: the callback is unique for the whole family (it is the URL registered at the
 *  provider), so nothing in its path says whose return it is. The prefix designates; it proves
 *  nothing, since it comes back through the query like everything else. The proof is the secret,
 *  which exists only if we opened the flow, plus the ownership check comparing the flow found to the
 *  claimed provider.
 *
 *  16 bytes of `randomBytes`, same quality as a `flowId`: `Math.random` is not cryptographic, and this
 *  token is the only gate of an unauthenticated request that writes a secret. */
export function mintState(provider: ProviderKind): string {
  return `${provider}.${randomBytes(16).toString("base64url")}`;
}

/** The inverse. While the prefix was part of the flow lookup key, a `state` claimed for another
 *  provider matched no flow, so the ownership check always received the matching provider and could
 *  never fail. Looking up by the secret alone and checking the prefix separately makes it reachable.
 *
 *  Split at the first dot: the secret keeps any of its own. */
export function splitState(state: string): { kind: string; secret: string } {
  const dot = state.indexOf(".");
  if (dot < 0) return { kind: "", secret: state };
  return { kind: state.slice(0, dot), secret: state.slice(dot + 1) };
}

/** A terminal provider refusal: the flow cannot succeed and must be closed.
 *
 *  Distinct from a transport incident (network, 5xx), which does not prevent retrying: `complete`
 *  throws an ordinary `Error` for that, and `routes.ts` treats it as transient. An explicit refusal
 *  (app not enabled, unrecognised error code) throws `ProviderRefusal`, on which the route closes the
 *  flow rather than let the operator retry for nothing. */
export class ProviderRefusal extends Error {}

const registry = new Map<ProviderKind, ConnectionProvider>();

export function registerProvider(provider: ConnectionProvider): void {
  registry.set(provider.kind, provider);
}

export function providerFor(kind: string): ConnectionProvider | undefined {
  return registry.get(kind as ProviderKind);
}

/** Registered providers in `PROVIDERS` order, never the registry's.
 *
 *  A `Map` returns insertion order, so module load order, so the import order of a file nobody reads
 *  with the UI in mind. On 16/09 `integrations/forge-access.ts` imported `gitlab-device.js` for a
 *  constant, and the Connections tiles went from "GitHub, GitLab, Linear" to "GitLab, GitHub, Linear".
 *
 *  A provider registered outside the list goes last rather than disappearing: the list orders, it
 *  does not filter. */
export function knownProviders(): ConnectionProvider[] {
  const rank = new Map(PROVIDERS.map((kind, i) => [kind, i]));
  return [...registry.values()].sort(
    (a, b) => (rank.get(a.kind) ?? PROVIDERS.length) - (rank.get(b.kind) ?? PROVIDERS.length),
  );
}
