// GitLab through device flow (RFC 8628): the same family as GitHub, and that is the point. The second
// implementation is what tells whether the port is one.
//
// Written without touching a real GitLab, like `integrations/gitlab.ts`: endpoints and field names
// come from GitLab's OAuth documentation.
//
// What GitLab reveals that GitHub hid: its host is not a constant. OAuth endpoints live on its
// instance, and an OAuth app is registered per instance: the `gitlab.com` `client_id` is worthless on
// a self-hosted GitLab. A self-hosted instance provides its URL and its own client id, both or neither.
//
// The instance is asked, not inferred (decision of 15/09). A first version inferred it from the
// repository (`hostOfRepoUrl`), pretending one client id would work everywhere, forcing repositories
// to be declared before connecting, with no answer for a project mixing two instances.
//
// And it is a property of the connection, not the server (15/09 fix, found by the first real call).
// The first version put it in `LEGION_GITLAB_HOST`, global to the Legion instance. The probe refused a
// valid framagit token by asking `gitlab.com`, and the message said the provider did not recognise the
// token, while nobody had talked to it. The host travels through the field this descriptor declares
// (`ProviderField`) and is stored in `metadata.fields`, in clear: neither host nor client id is secret.
//
// The two env variables remain as the instance default, so a single-GitLab install has nothing to type.
// What is set on the connection always wins.
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

const LABEL = "GitLab";
const DEFAULT_HOST = "https://gitlab.com";

// Two scopes, the second not redundant with the first:
//   - `api` covers repositories, merge requests, webhooks and pipelines: everything
//     `integrations/gitlab.ts` calls on `/api/v4`.
//   - `write_repository` covers git over HTTPS (clone and push), which `api` does not: GitLab separates
//     API access from git protocol access, and a token with only `api` gets an unexplained 403 on
//     `git push`.
//
// Single source, as for GitHub: `routes.ts` reads `scopes` to write `metadata`; `SCOPE` derives from it.
const GITLAB_SCOPES = ["api", "write_repository"] as const;
const SCOPE = GITLAB_SCOPES.join(" ");

/** The field key, so the key under which `metadata.fields` stores the host.
 *
 *  Exported since 16/09 for one reader in another domain: `integrations/forge-access.ts`, which
 *  discovers a connection's repositories and must know which instance it talks to. Copying `"host"`
 *  there would put two halves of one convention in two files. */
export const HOST_FIELD = "host";

/** The instance the connection designates, or nothing: the connection's value first, the instance
 *  default next, then nothing. `gitlab.com` does not enter here: that silent assumption is what
 *  refused a framagit token.
 *
 *  The trailing `/` is stripped, or the endpoint URL would become `//oauth/authorize_device`. */
function declaredHost(field: string | undefined): string {
  const raw = field?.trim() || process.env.LEGION_GITLAB_HOST || "";
  return raw.replace(/\/+$/, "");
}

/** The GitLab app `client_id`, public by design. Empty while no app is registered for this instance:
 *  the route then says so instead of calling GitLab for nothing. */
function clientId(): string {
  return process.env.LEGION_GITLAB_CLIENT_ID ?? "";
}

/** What is missing, in a few words (round 2). The previous sentences explained that an OAuth app and a
 *  token belong to an instance: a mechanism, for someone who wants to connect a tool. What they need
 *  is what to set.
 *
 *  `MISSING_HOST` is also the tile field's `missing`; the field label already says which one. */
const MISSING_HOST = "GitLab instance URL required";

const MISSING_APP = "LEGION_GITLAB_CLIENT_ID required";

/** GitLab has no `device_flow_disabled` equivalent: outside the RFC's four codes nothing more is known,
 *  so the code is named as is rather than inventing a diagnosis. */
function refusal(error: string): string {
  return `GitLab refused the flow: ${error}`;
}

export const gitlabDevice: ConnectionProvider = {
  kind: PROVIDER.gitlab,
  secretName: "GITLAB_TOKEN",
  scopes: GITLAB_SCOPES,
  /** The instance host, asked of the operator: the only tile asking for something (GitHub and Linear
   *  live on constants).
   *
   *  The suggestion reuses the instance default when there is one, `gitlab.com` otherwise, so a
   *  single-GitLab install has nothing to type and what is sent is what was shown. `gitlab.com` offered
   *  in a visible field is a choice the operator accepts; `gitlab.com` as a last resort in
   *  `declaredHost` is a silent assumption, and that refused a valid token. */
  field: () => ({
    name: HOST_FIELD,
    label: "GitLab instance URL",
    suggestion: declaredHost(undefined) || DEFAULT_HOST,
    missing: MISSING_HOST,
  }),
  /** Three refusals, fixed in two places: the host is typed in the tile, the client id set in
   *  `server/.env`. "No gitlab app declared" does not help someone whose app exists but whose host is
   *  missing, and sends them to the wrong place. */
  unconfigured: (field) => {
    const noHost = declaredHost(field).length === 0;
    const noApp = clientId().length === 0;
    if (noHost && noApp) return `${MISSING_HOST} ${MISSING_APP}`;
    if (noHost) return MISSING_HOST;
    return noApp ? MISSING_APP : null;
  },
  // Two pages, on the instance holding the token, never `gitlab.com` by default.
  // `/-/user_settings/applications` cuts an OAuth grant; `/-/user_settings/personal_access_tokens`
  // revokes a personal token, which is almost always what gets pasted.
  //
  // The only place `gitlab.com` still serves as last resort, deliberately: a link must lead somewhere
  // and carries no token; at worst it shows the wrong page, which is visible at a glance. A request
  // goes with the connection's host or not at all.
  revokeUrl: (origin, field) => {
    const base = declaredHost(field) || DEFAULT_HOST;
    return origin === TOKEN_ORIGIN.pasted
      ? `${base}/-/user_settings/personal_access_tokens`
      : `${base}/-/user_settings/applications`;
  },
  /** A pasted token, presented to GitLab. Two calls answering different questions: `GET /user` says
   *  whether the token is worth anything (it alone decides refusal), `GET /personal_access_tokens/self`
   *  says what it may do.
   *
   *  The second may fail with a good token (an OAuth token is not a PAT, a narrow PAT too), which is
   *  why it comes after: `probe` returns `null`, read here as "scopes unknown", not a refusal.
   *  Swapping the calls would declare a valid token dead. */
  async adopt(token, field) {
    // The connection's host, not `gitlab.com` (the 15/09 fix). An empty host cannot arrive here:
    // `routes.ts` refuses adoption naming `MISSING_HOST` first, and `adopt-pasted.ts` does the same.
    const base = declaredHost(field);
    const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
    const user = await probe(LABEL, `${base}/api/v4/user`, { headers });
    if (!user) return null;
    const me = (await user.json()) as { username?: unknown };
    const self = await probe(LABEL, `${base}/api/v4/personal_access_tokens/self`, { headers });
    const described = self ? ((await self.json()) as { scopes?: unknown }) : null;
    return {
      scopes: Array.isArray(described?.scopes)
        ? described.scopes.filter((s): s is string => typeof s === "string")
        : null,
      account: typeof me.username === "string" ? me.username : null,
    };
  },
  async begin({ field }) {
    const r = await postForm(LABEL, `${declaredHost(field)}/oauth/authorize_device`, {
      client_id: clientId(),
      scope: SCOPE,
    });
    return {
      kind: FLOW_KIND.device,
      userCode: required(r, "user_code", LABEL),
      verificationUri: required(r, "verification_uri", LABEL),
      intervalMs: optionalNumber(r, "interval", 5) * 1000,
      expiresAt: Date.now() + optionalNumber(r, "expires_in", 900) * 1000,
      exchange: required(r, "device_code", LABEL),
    };
  },
  // The host comes from the flow, not the environment: `begin` opened the device flow there and the
  // `device_code` is only exchanged there. Reading it elsewhere would send one instance's secret to
  // another (comment A of `flows.ts`).
  async complete(exchange, arrived, field) {
    // Same refusal as GitHub: RFC 8628 has no redirect. `ProviderRefusal` because it is terminal (see
    // comment B of `github-device.ts`).
    if (arrived.kind === ARRIVED_KIND.code)
      throw new ProviderRefusal(
        "The GitLab device flow receives no authorization code: it starts over.",
      );
    const r = await postForm(LABEL, `${declaredHost(field)}/oauth/token`, {
      client_id: clientId(),
      device_code: exchange,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (r.access_token) return { status: FLOW_STATUS.connected, accessToken: r.access_token };
    return { status: translateDeviceError(r.error ?? "unknown", refusal) };
  },
};

registerProvider(gitlabDevice);
