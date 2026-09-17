// Linear through authorisation code + PKCE: the first implementation of the `redirect` family, the
// one the port was reshaped for. A two-branch union with one branch inhabited proves nothing.
//
// Why not a device grant: Linear offers none. It offers the authorisation code, where PKCE (RFC 7636)
// replaces the `client_secret` (optional at Linear once a `code_verifier` accompanies the exchange),
// leaving `client_id` public as at GitHub.
//
// The secret name is `LINEAR_TOKEN` and it does not carry the format; `metadata` does. Linear takes an
// OAuth token as `Authorization: Bearer <token>` and a personal key raw. `integrations/linear.ts` first
// sent the raw form (which would have failed every GraphQL request once connected), then hard-coded
// `Bearer` (killing every pasted personal key): the same mistake reversed, from believing a secret
// name can decide what only the provider can. The probe observes the format, `metadata.authFormat`
// stores it, and use reads it back.
//
// No migration renames the existing row, on purpose: the value under `LINEAR_API_KEY` is a personal
// key. Renamed, it would be sent as `Bearer` and refused: a broken secret that looks valid. It stays
// and stops being read; the operator reconnects Linear in one click.
//
// `postForm` and `required` come from `device-flow.ts` and are not specific to device grants.
import { createHash, randomBytes } from "node:crypto";
import { optionalNumber, optionalString, postForm, required } from "./device-flow.js";
import {
  ARRIVED_KIND,
  AUTH_FORMAT,
  FLOW_KIND,
  FLOW_STATUS,
  mintState,
  PROVIDER,
  ProviderRefusal,
  registerProvider,
  type ConnectionProvider,
} from "./providers.js";

const LABEL = "Linear";
const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const GRAPHQL_URL = "https://api.linear.app/graphql";

/** Where Linear access is really revoked; Legion can only forget it (see `revokeUrl` in
 *  `providers.ts`).
 *
 *  One page for both origins, a fact of Linear: its account security settings hold authorised apps
 *  and personal keys together. GitHub and GitLab split them, so their adapters branch on origin. If
 *  Linear splits them, this constant becomes a function; the port already passes the origin. */
const REVOKE_URL = "https://linear.app/settings/account/security";

// Two scopes, and `write` is not a convenience: Legion writes to Linear. `moveIssueInProgress`
// (`integrations/linear.ts`) sends an `issueUpdate` moving an issue to "In Progress" when a task
// starts. A read-only connection would fail that call in the least visible place, a fire-and-forget.
const LINEAR_SCOPES = ["read", "write"] as const;
// Linear separates scopes with commas, where GitHub and GitLab use spaces. Copying `join(" ")` would
// have broken silently: one scope named "read write", refused only at the first API call.
const SCOPE = LINEAR_SCOPES.join(",");

/** How long the operator has to click "Authorize". Linear documents no expiry for the consent page;
 *  ten minutes is what RFC 6749 recommends for a code's life, and it also bounds the `state`, so the
 *  replay window. */
const AUTHORIZE_TTL_MS = 10 * 60 * 1000;

/** Legion's Linear app `client_id`, public by design. Empty while no app is registered: the route says
 *  so instead of sending the operator to a consent page that will refuse. */
function clientId(): string {
  return process.env.LEGION_LINEAR_CLIENT_ID ?? "";
}

/** The callback path. It must agree with the `app.get` in `routes.ts`, which writes it as a literal
 *  (`scripts/api-contract.ts` reads literals, not constants). `routes.test.ts` starts from the
 *  authorisation URL produced here and hits the path it contains, so a mismatch fails tests rather
 *  than an operator's connection. */
const CALLBACK_PATH = "/api/connections/callback";

/** Where the operator's browser reaches this instance. No default and no hard-coded address:
 *  `http://localhost:8790` on a workstation, `https://<machine>.ts.net` behind a Tailscale name, a
 *  domain behind a front end.
 *
 *  An env variable rather than a database setting: `begin` and `complete` read it outside any request,
 *  and it must be identical at both moments and to what is registered at the provider. A database
 *  setting would need a screen to set it before any connection can exist.
 *
 *  Not derived from the request `Host`, though it is at hand in `routes.ts`: the value is registered
 *  once at the provider, and Linear refuses the exchange if the two differ by a character. Deriving it
 *  would make the connection depend on the address the screen was opened from that day (fine from
 *  `localhost`, refused from the tailnet). It is also the easiest header for a caller to set.
 *
 *  Not `PUBLIC_BASE_URL` either (`integrations/inbound-webhooks.ts`): that answers "how does a third-party
 *  server reach me", the Tailscale funnel URL deliberately limited to `/webhooks`. An OAuth callback is
 *  a redirect of the operator's browser to `/api/…`, which needs no public reachability. They may
 *  coincide today; merging them would break connections the day the funnel is restricted. */
function publicUrl(): string | null {
  const raw = process.env.LEGION_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return raw ? raw : null;
}

/** Where the browser comes back: identical going out, coming back, and at Linear, or the exchange is
 *  refused. `null` while the instance does not know where it is. */
function redirectUri(): string | null {
  const base = publicUrl();
  return base ? `${base}${CALLBACK_PATH}` : null;
}

/** The same, for the two moments it must exist. The route already refuses an unconfigured provider,
 *  so this only fires if the setting vanishes in between; better named than sending the string "null"
 *  to Linear and reading an `invalid_grant` that points at nothing. */
function mustRedirectUri(): string {
  const uri = redirectUri();
  if (!uri)
    throw new ProviderRefusal(
      "The public URL of this instance (LEGION_PUBLIC_URL) vanished mid-flow: Linear can no longer be called back at the same address as on the way out.",
    );
  return uri;
}

/** One attempt at presenting the token under one header format.
 *
 *  Returns the account when Linear recognises the token, `null` when it refuses it in this format.
 *  Throws on 5xx or network failure: a transport incident is not a refusal.
 *
 *  A 200 is not enough: GraphQL happily answers 200 with errors in the body. `data.viewer` proves the
 *  token worked, not the HTTP status.
 *
 *  The object wraps the account because a bare `string | null` would merge "Linear does not know this
 *  token" and "it does, but its bearer has no readable email or name". */
async function viewerWith(authorization: string): Promise<{ account: string | null } | null> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ query: "{ viewer { id name email } }" }),
  });
  // A refusal is an authentication refusal and nothing else. Linear answers 400 to a header it cannot
  // read (the usual wrong-format case), so it counts. A 429 or 5xx does not: transient incidents.
  // `probe` makes the same split for the other providers.
  //
  // Caveat, look here if it breaks: reading 400 as an authentication refusal rests on documentation,
  // not a real call. GraphQL also answers 400 to a malformed query, so if Linear's schema changes and
  // `viewer { id name email }` stops being valid, a good token would be declared dead in both formats.
  // The symptom would be "Linear never recognises any token": suspect this 400 first, and the `errors`
  // body will say whether it is syntax or authentication.
  if (!res.ok && res.status !== 400 && res.status !== 401 && res.status !== 403)
    throw new Error(`${LABEL} answered ${res.status} on ${GRAPHQL_URL}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { viewer?: { name?: unknown; email?: unknown } } };
  const viewer = body.data?.viewer;
  if (!viewer) return null;
  const account = [viewer.email, viewer.name].find((v) => typeof v === "string" && v.length > 0);
  return { account: typeof account === "string" ? account : null };
}

export const linearRedirect: ConnectionProvider = {
  kind: PROVIDER.linear,
  secretName: "LINEAR_TOKEN",
  scopes: LINEAR_SCOPES,
  // Two things can be missing, fixed by different acts: hence a sentence, not a boolean. Public URL
  // first (without it there is nothing to register at Linear), then the app, whose refusal carries the
  // redirect URL to copy into their form, since a guessed URL off by one character gives an unreadable
  // refusal.
  //
  // The price of the family, not Linear's heaviness: GitHub and GitLab use device grants with no
  // redirect URL (RFC 8628), so they work on an instance reached by IP with no DNS or TLS. Linear comes
  // back through the browser, so it needs an address, the same on both sides.
  //
  // The message names the variable and nothing else (round 2), plus the redirect URL, which is a value
  // to copy at the provider character for character and is written nowhere else.
  unconfigured: () => {
    const uri = redirectUri();
    if (!uri) return "LEGION_PUBLIC_URL required";
    if (!clientId()) return `LEGION_LINEAR_CLIENT_ID required — redirect URL: ${uri}`;
    return null;
  },
  // Origin is not read, the only one of the three: see `REVOKE_URL`.
  revokeUrl: () => REVOKE_URL,
  /** A pasted token, presented to Linear: the only provider whose header format cannot be inferred
   *  from the token. A personal key goes raw, an OAuth token as `Bearer` (Linear docs, checked 15/09).
   *
   *  Decided by trying, in a deliberate order: this route serves a pasted token, almost always a
   *  personal key (OAuth tokens come through the button, not here). The first attempt is the usual
   *  case; the second serves someone pasting a token obtained elsewhere.
   *
   *  Two calls at worst, only at paste time.
   *
   *  The winning format is stored, which this method used to miss. Its comment claimed `LINEAR_TOKEN`
   *  carried the convention by name: true of an OAuth token, false of a personal key accepted at the
   *  first (raw) attempt. With `gql()` always sending `Bearer`, a pasted key was accepted here then
   *  refused at every use: "connected" on screen, every Issues request failing. The format is a fact
   *  the probe observes, and `metadata` stores such facts. */
  async adopt(token) {
    // The successful attempt is kept, not just its result: it carries the format.
    const asRaw = await viewerWith(token);
    const found = asRaw ?? (await viewerWith(`Bearer ${token}`));
    if (!found) return null;
    // Linear does not publish a personal key's scopes (it is worth what its bearer is worth). `null`
    // says unknown; copying `LINEAR_SCOPES` would show as observed an access nobody observed.
    return {
      scopes: null,
      account: found.account,
      authFormat: asRaw ? AUTH_FORMAT.raw : AUTH_FORMAT.bearer,
    };
  },
  async begin() {
    // PKCE (RFC 7636): 64 random bytes in base64url are 86 characters, above the RFC's 43 minimum. The
    // verifier never goes to the public network; only its hash goes in the consent URL, so someone
    // intercepting the returning `code` cannot exchange it.
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = mintState(PROVIDER.linear);
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId());
    url.searchParams.set("redirect_uri", mustRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return {
      kind: FLOW_KIND.redirect,
      authorizeUrl: url.toString(),
      expiresAt: Date.now() + AUTHORIZE_TTL_MS,
      // Both flow secrets in one bag, since `flows.ts` keeps one and neither may cross HTTP. The
      // `state` copy here is the authoritative one on return, the one the browser cannot touch.
      exchange: JSON.stringify({ verifier, state }),
    };
  },
  async complete(exchange, arrived) {
    // A redirect flow is not polled: the browser comes back and the callback concludes. Symmetric to
    // the device adapters refusing a `code`, and `ProviderRefusal` for the same reason (comment B of
    // `github-device.ts`): a bare `Error` would be read as a transport incident, "pending" forever.
    if (arrived.kind === ARRIVED_KIND.poll)
      throw new ProviderRefusal(
        "The Linear redirect flow does not restart: it is waiting for its callback.",
      );
    const { verifier } = JSON.parse(exchange) as { verifier: string };
    const r = await postForm(LABEL, TOKEN_URL, {
      code: arrived.code,
      // Identical to the way out, or Linear refuses the exchange; the same function produces both.
      redirect_uri: mustRedirectUri(),
      client_id: clientId(),
      code_verifier: verifier,
      grant_type: "authorization_code",
    });
    // `expires_in` is about 86399 at Linear, twenty-four hours: the first provider whose token dies,
    // hence the first returning a `refresh_token`. Both travel to `putSecret`; renewal itself is not
    // implemented (`secret-access.ts`). Absent or unreadable, no expiry is invented: `expiresAt` stays
    // absent, meaning "no known expiry", not "never expires".
    const expiresIn = optionalNumber(r, "expires_in", 0);
    return {
      status: FLOW_STATUS.connected,
      accessToken: required(r, "access_token", LABEL),
      refreshToken: optionalString(r, "refresh_token"),
      expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    };
  },
};

registerProvider(linearRedirect);
