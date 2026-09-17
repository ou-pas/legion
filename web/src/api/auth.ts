// Which credential the control plane actually uses. The route NEVER returns the value: only its
// kind, a mask (first eleven characters and the length) and detected defects. That is deliberate
// on the server, and the screen must not work around it.
import { json } from "./client.js";

export type AuthKind = "api-key" | "oauth" | "none";

export type AuthWarning = {
  /** `oauth-in-api-key`: an OAuth token stored in ANTHROPIC_API_KEY, which would be silently
   *  refused. `oauth-malformed`: a token that does not follow the expected shape. */
  type: "oauth-in-api-key" | "oauth-malformed";
  message: string;
};

export type AuthIdentity = {
  kind: AuthKind;
  /** `sk-ant-4k2l… (24 chars)`, or `null` when there is nothing to mask. */
  masked: string | null;
  warnings: AuthWarning[];
};

export const authApi = {
  identity: (): Promise<AuthIdentity> => fetch("/api/auth/identity").then(json),
};
