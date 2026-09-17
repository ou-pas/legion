// Connecting a provider without pasting a token.
//
// The `flowId` is OPAQUE: it is exchanged for nothing anywhere but this server. The secret that
// obtains the token (GitHub's `device_code`) never travels this far.
//
// Two families, one union, and the screen switches on `kind`. The OAuth families differ in where
// authorization comes back: in `device`, through OUR polling while the operator types a code
// elsewhere; in `redirect`, through the browser, which goes to the provider and calls us back.
// Optional fields would have made every reader guess which world they are in.
//
// The enums follow the repo rule (`server/src/shared/enums.ts`): the key carries the concept, the
// value the serialisation. They mirror `server/src/connections/providers.ts`.
import { json, post } from "./client.js";

/** The server decides the list: the screen shows what `GET /api/connections` returns. */
export const PROVIDER = { github: "github", gitlab: "gitlab", linear: "linear" } as const;
export const PROVIDERS = [PROVIDER.github, PROVIDER.gitlab, PROVIDER.linear] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

/** Where authorization comes back. No derived type here: `kind` is the DISCRIMINANT of
 *  `FlowStart`, so each branch carries its own value (`typeof FLOW_KIND.device`), and a `FlowKind`
 *  union would have no reader, which `make deadcode` counts as debt. */
export const FLOW_KIND = { device: "device", redirect: "redirect" } as const;

/** Where a token came from, which is not "can we renew it": `granted` at the end of an
 *  authorization flow, `pasted` when the operator pasted it. A token can come from a connection
 *  without being renewable (GitHub today); the reverse is impossible. */
export const TOKEN_ORIGIN = { granted: "granted", pasted: "pasted" } as const;
export const TOKEN_ORIGINS = [TOKEN_ORIGIN.granted, TOKEN_ORIGIN.pasted] as const;
export type TokenOrigin = (typeof TOKEN_ORIGINS)[number];

/** `slowDown` is a provider answer, not an error: it asks to space out polling, and the screen
 *  obeys rather than hammering. */
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

export type Connection = {
  provider: ProviderKind;
  /** The name the token is stored under, the one the rest of the server already reads. */
  secretName: string;
  connected: boolean;
  /** True if Legion can renew this token by itself (a refresh token). Says nothing of its origin:
   *  a GitHub connection is granted yet not renewable. */
  renewable: boolean;
  /** `null` when nothing is connected. This, not `renewable`, decides what the tile says. */
  origin: TokenOrigin | null;
  /** What the token can do, as observed at acquisition. `null` means "unknown" and the screen must
   *  SAY so: a fine-grained token does not publish its scopes, and an empty list would read as
   *  "this token can do nothing", which is false. */
  scopes: readonly string[] | null;
  /** The account the token belongs to, when the provider named it. */
  account: string | null;
  /** Epoch ms of the CURRENT connection; reconnecting replaces the row, so the date. */
  connectedAt: number | null;
  /** Why the button is disabled, in one provider sentence (it may carry the redirect URL to copy).
   *  `null` when nothing is missing. */
  unconfigured: string | null;
  /** Where the token is really revoked, at the provider. Disconnecting in Legion only FORGETS the
   *  token: revoking needs app authentication Legion lacks (no `client_secret`), so the screen
   *  shows this link next to the gesture or it would imply a revocation that does not happen.
   *
   *  Server-provided, because the URL depends on the instance (a self-hosted GitLab does not revoke
   *  on `gitlab.com`) and on the token's ORIGIN (an OAuth grant and a personal token are revoked on
   *  different pages). `null` when the origin is unknown: picking a page would send the operator
   *  where the token is not listed. */
  revokeUrl: string | null;
  /** What the provider requires besides the token, `null` for those that require nothing.
   *
   *  The screen does not know what it is: it gets a label and a value to prefill, as it gets
   *  `unconfigured`. Today it is the GitLab instance: an OAuth app is registered per instance and a
   *  token belongs to ONE instance, so the host is a property of the connection. `suggestion` is
   *  prefilled, so the operator SEES it before sending: the connection's value if connected, else
   *  the instance default. */
  field: { label: string; suggestion: string } | null;
};

/** Secret names owned by a provider. The server is the source (`GET /api/connections`); this list
 *  decides NOTHING, it only feeds a mention on the secrets card saying where a row should have come
 *  from. A missing name breaks nothing, it loses its sentence. */
export const CONNECTION_SECRET_NAMES: readonly string[] = [
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
  "LINEAR_TOKEN",
];

export type FlowStart = { flowId: string; expiresAt: number } & (
  | { kind: typeof FLOW_KIND.device; userCode: string; verificationUri: string; intervalMs: number }
  | { kind: typeof FLOW_KIND.redirect; authorizeUrl: string }
);

export const connectionsApi = {
  list: (projectId: string): Promise<{ connections: Connection[] }> =>
    fetch(`/api/connections?projectId=${encodeURIComponent(projectId)}`).then(json),
  /** `field` is also sent from the button, not only on paste: a GitLab device flow opens ON an
   *  instance, and the server refuses naming what is missing rather than assuming one. */
  start: (provider: ProviderKind, projectId: string, field?: string): Promise<FlowStart> =>
    post(`/api/connections/${provider}/start`, { projectId, field }),
  poll: (provider: ProviderKind, flowId: string): Promise<{ status: FlowStatus }> =>
    post(`/api/connections/${provider}/poll`, { flowId }),
  /** The second acquisition path: a token obtained elsewhere is pasted, the server PROBES it and
   *  stores it only if the provider recognised it. The token does not come back. */
  adopt: (
    provider: ProviderKind,
    projectId: string,
    token: string,
    field?: string,
  ): Promise<{ connected: true }> =>
    post(`/api/connections/${provider}/adopt`, { projectId, token, field }),
  /** FORGETS the token on Legion's side, nothing more: it stays valid at the provider until the
   *  operator revokes it there (see `revokeUrl`). `forgotten: false` when there was nothing, so the
   *  gesture replays harmlessly. */
  forget: (provider: ProviderKind, projectId: string): Promise<{ forgotten: boolean }> =>
    fetch(`/api/connections/${provider}/token?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }).then(json),
};
