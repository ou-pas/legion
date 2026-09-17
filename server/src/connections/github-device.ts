// GitHub through device flow (RFC 8628): the only GitHub flow needing no `client_secret`.
//
// Why not PKCE: GitHub OAuth Apps do not support it, and the classic authorisation code requires a
// secret, so device flow is the only way to keep `client_id` public. It must be enabled once in the
// app settings ("Enable Device Flow"); otherwise GitHub answers `device_flow_disabled`, named below
// because it is a thirty-second fix once understood.
//
// Shared mechanics are in `device-flow.ts`: GitLab implements the same RFC.
import { optionalNumber, postForm, probe, required, translateDeviceError } from "./device-flow.js";
import {
  ARRIVED_KIND,
  FLOW_KIND,
  FLOW_STATUS,
  PROVIDER,
  ProviderRefusal,
  registerProvider,
  TOKEN_ORIGIN,
  type ConnectionProvider,
} from "./providers.js";

const LABEL = "GitHub";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

/** The header saying what a PAT may do. GitHub sets it on any API response for a classic PAT or an
 *  OAuth token. It fixes the one real handicap of a pasted token: otherwise its scopes are unknown. */
const SCOPES_HEADER = "x-oauth-scopes";

// Three scopes, each for a real use, audited against what Legion calls:
//   - `repo` covers HTTPS clone and push, reading a repository, pull requests, check runs, assignment
//     and repository webhooks. `admin:repo_hook` is not needed: it is the narrow scope for hooks only.
//   - `read:org` covers listing organisations. Without it an organisation that has not approved
//     Legion's app is indistinguishable from one where the operator has nothing (empty list either
//     way): the difference between "nothing for you here" and "go click Approve in your org settings".
//   - `user:email` serves `GET /user/emails` (`integrations/github.ts`): without it
//     `listVerifiedEmails` answers 403/404 and the git identity check
//     (`projects/git-identity-check.ts`) stays stuck on "unknown".
//
// A scope is added at first consent or never: GitHub freezes granted scopes at click time, so adding
// one later makes every existing connection re-authorise. That is a connection migration, not a line
// change.
//
// Single source: this array is what `githubDevice.scopes` gives `routes.ts` to write into `metadata`.
// `SCOPE` (the space-separated form GitHub's URL expects) derives from it.
const GITHUB_SCOPES = ["repo", "read:org", "user:email"] as const;
const SCOPE = GITHUB_SCOPES.join(" ");

/** Legion's GitHub app `client_id`. Public by design (it travels in the consent URL), so committed.
 *
 *  Registered since 15/09; two form settings matter for this code. "Enable Device Flow" is checked:
 *  otherwise GitHub answers `device_flow_disabled` (named in `refusal`). "Expire user access tokens"
 *  is unchecked on purpose: checked, GitHub would return an eight-hour token with a `refresh_token`
 *  that `refresh_ciphertext` could store but nothing reads yet, so the connection would die silently
 *  after eight hours. Check it once renewal exists; until then a token without expiry is exactly what
 *  the replaced PAT was.
 *
 *  `LEGION_GITHUB_CLIENT_ID` is the way out for someone running their own instance with their own
 *  app. */
const DEFAULT_CLIENT_ID = "Ov23li2HBR9oQiz3MFMv";

function clientId(): string {
  return process.env.LEGION_GITHUB_CLIENT_ID ?? DEFAULT_CLIENT_ID;
}

/** GitHub's only proprietary refusal in this flow; the rest of the translation is the RFC. */
function refusal(error: string): string {
  return error === "device_flow_disabled"
    ? "Device flow is not enabled on Legion's GitHub app (app settings → Enable Device Flow)."
    : `GitHub refused the flow: ${error}`;
}

export const githubDevice: ConnectionProvider = {
  kind: PROVIDER.github,
  secretName: "GITHUB_TOKEN",
  scopes: GITHUB_SCOPES,
  // A device grant only lacks its app: no redirect URL to register, so it works on an instance with
  // no DNS or TLS, reached by IP. Linear does not have that luxury (see `linear-redirect.ts`). The
  // message names the variable and nothing else (round 2): whoever reads it will set it.
  unconfigured: () => (clientId().length > 0 ? null : "LEGION_GITHUB_CLIENT_ID required"),
  // Two pages. A granted token is an OAuth grant, revoked in the account's authorised applications.
  // A pasted token is almost always a personal token, which does not appear there: it lives in
  // `/settings/tokens`. The first version sent everyone to applications.
  revokeUrl: (origin) =>
    origin === TOKEN_ORIGIN.pasted
      ? "https://github.com/settings/tokens"
      : "https://github.com/settings/applications",
  /** A pasted token, presented to GitHub. `GET /user` answers the same to a PAT and an OAuth token:
   *  automation depends on what a token can do, not where it came from.
   *
   *  Three cases, the third being the trap:
   *    · 401, or 403 without a quota header: `probe` returns `null`, refused, nothing written. A quota
   *      403 throws instead: GitHub rate-limits with that code, and reading it as a refusal would send
   *      the operator looking for a new token when theirs is fine.
   *    · `x-oauth-scopes` present: its scopes, observed. Empty (`""`) is also a fact: no scopes, an
   *      empty array, not an unknown.
   *    · header absent: a fine-grained PAT, whose permissions GitHub does not publish this way. The
   *      account is known, scopes are not, and that is written as `null`. Copying `GITHUB_SCOPES` here
   *      would show as fact an access nobody observed. */
  async adopt(token) {
    const res = await probe(LABEL, USER_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "legion",
      },
    });
    if (!res) return null;
    const raw = res.headers.get(SCOPES_HEADER);
    const user = (await res.json()) as { login?: unknown };
    return {
      scopes:
        raw === null
          ? null
          : raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
      account: typeof user.login === "string" ? user.login : null,
    };
  },
  async begin() {
    const r = await postForm(LABEL, DEVICE_CODE_URL, { client_id: clientId(), scope: SCOPE });
    return {
      kind: FLOW_KIND.device,
      userCode: required(r, "user_code", LABEL),
      verificationUri: required(r, "verification_uri", LABEL),
      intervalMs: optionalNumber(r, "interval", 5) * 1000,
      expiresAt: Date.now() + optionalNumber(r, "expires_in", 900) * 1000,
      exchange: required(r, "device_code", LABEL),
    };
  },
  async complete(exchange, arrived) {
    // A device grant never receives a code: RFC 8628 has no redirect.
    //
    // B: `ProviderRefusal`, not a bare `Error`. `routes.ts` classifies every ordinary `Error` as a
    // transport incident, so a bare one here would return `pending` on every tick forever, logging a
    // fake network incident: a programming error disguised as an outage. This refusal is terminal.
    if (arrived.kind === ARRIVED_KIND.code)
      throw new ProviderRefusal(
        "The GitHub device flow receives no authorization code: it starts over.",
      );
    const r = await postForm(LABEL, ACCESS_TOKEN_URL, {
      client_id: clientId(),
      device_code: exchange,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (r.access_token) return { status: FLOW_STATUS.connected, accessToken: r.access_token };
    return { status: translateDeviceError(r.error ?? "unknown", refusal) };
  },
};

registerProvider(githubDevice);
