// Inbound webhooks, forge half (webhooks batch, 03/09): the instance
// secret, signature checks, payload parsing, hooking a repository. Nothing here knows what a task is;
// the decision (identify the task, reread the forge, finish) lives in `review/merge-events.ts`, just as
// `review/open-pr.ts` composes tasks and integrations.
//
// The gate is a signature, not an address. These routes are meant to be publicly exposed (Tailscale
// Funnel), so cryptographic proof decides: HMAC-SHA256 of the raw body for GitHub, a header token for
// GitLab, constant-time comparison in both. One instance secret, generated at first hook, never shown:
// the server presents it to the forges.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { logControlEvent } from "../events/control-log-store.js";
import { repoRow, setRepoWebhook } from "./integrations-store.js";
import { hasMasterKey } from "../shared/crypto.js";
import { getEncryptedSetting, getSetting, setEncryptedSetting } from "../shared/settings.js";
import { resolveForgeRepos } from "./forge-access.js";
import type { RepoHookResult } from "./forge.js";

export const PUBLIC_BASE_URL_KEY = "public_base_url";
const SECRET_KEY = "inbound_webhook_secret";

/** Beyond this, not even read: no PR event weighs that much, and the body must be read whole to check
 *  the signature. Without a cap the public gate would invite feeding gigabytes to the control plane. */
export const MAX_BODY_BYTES = 512 * 1024;

/** The instance secret, created at the first hook (never on an inbound request: generating on a
 *  stranger's request would let them choose when). 32 random bytes in hex: enough for an HMAC, readable
 *  in a forge config field. */
export function inboundWebhookSecret(): string {
  const existing = getEncryptedSetting(SECRET_KEY);
  if (existing) return existing;
  const secret = randomBytes(32).toString("hex");
  setEncryptedSetting(SECRET_KEY, secret);
  return secret;
}

/** Whether a secret exists, for the UI and the route, which never see the value. */
export function hasInboundWebhookSecret(): boolean {
  return getEncryptedSetting(SECRET_KEY) !== null;
}

export function publicBaseUrl(): string | null {
  const v = getSetting(PUBLIC_BASE_URL_KEY)?.trim();
  return v ? v.replace(/\/+$/, "") : null;
}

/** Constant-time comparison accepting different lengths without throwing: `timingSafeEqual` requires
 *  equal sizes, and unequal sizes already mean no. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** GitHub: `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>`. */
export function verifyGithubSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(header, expected);
}

/** GitLab: the secret travels as is in `X-Gitlab-Token`, no HMAC. */
export function verifyGitlabToken(header: string | undefined, secret: string): boolean {
  return typeof header === "string" && header.length > 0 && safeEqual(header, secret);
}

/** What a payload yields: the change request URL and what just happened to it. `null` means an event
 *  we ignore (opened, synchronize, ping, note…), the most frequent case, worth a silent 200 rather than
 *  an error: a hook accumulating failures gets disabled by the forge. */
export type ForgeEvent = { kind: "merged" | "closed"; url: string };

export function parseGithubEvent(eventName: string | undefined, body: unknown): ForgeEvent | null {
  if (eventName !== "pull_request") return null;
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.action !== "closed") return null;
  const pr = (b.pull_request ?? {}) as Record<string, unknown>;
  const url = typeof pr.html_url === "string" ? pr.html_url : null;
  if (!url) return null;
  return { kind: pr.merged === true ? "merged" : "closed", url };
}

export function parseGitlabEvent(eventName: string | undefined, body: unknown): ForgeEvent | null {
  if (eventName !== "Merge Request Hook") return null;
  const attrs = (((body ?? {}) as Record<string, unknown>).object_attributes ?? {}) as Record<
    string,
    unknown
  >;
  const url = typeof attrs.url === "string" ? attrs.url : null;
  if (!url) return null;
  if (attrs.action === "merge") return { kind: "merged", url };
  if (attrs.action === "close") return { kind: "closed", url };
  return null;
}

/** Hooks Legion's webhook on one repository: resolves token and adapter the same way as the whole
 *  module (`resolveForgeRepos`), creates the hook on the forge, and stores its id and the served URL on
 *  the row. The URL because a hook "connected" to a base that changed is dead while the badge believes
 *  it alive; reconnecting then creates a hook on the new URL (removing the old one is not in this batch).
 *
 *  Every failure is named (missing master key, missing public URL, undeclared forge, missing token, API
 *  refusal), since this button is the only place the operator sees them. */
export async function connectRepoWebhook(repoId: string): Promise<RepoHookResult> {
  // The first secret Legion gives a third party: without a master key it would be written in clear on
  // the disk of an instance about to be exposed. Refused: a dev instance has nothing to hook, an
  // exposed instance has a master key.
  if (!hasMasterKey() && !hasInboundWebhookSecret())
    return {
      ok: false,
      error:
        "LEGION_MASTER_KEY missing: the webhook secret will not be written in clear on an instance that gets exposed",
    };
  const base = publicBaseUrl();
  if (!base)
    return {
      ok: false,
      error:
        "public URL not set (System → General → Inbound webhooks): the forge would not know whom to call",
    };
  const repo = repoRow(repoId);
  if (!repo) return { ok: false, error: "repo not found" };

  const { resolved, errors } = await resolveForgeRepos(repo.projectId, [repo.name]);
  const hit = resolved[0];
  if (!hit)
    return { ok: false, error: errors[0]?.error ?? "forge or token not resolved for this repo" };

  const hookUrl = `${base}/webhooks/${hit.adapter.kind}`;
  const result = await hit.adapter.createRepoHook(hit.token, hit.repo, {
    url: hookUrl,
    secret: inboundWebhookSecret(),
  });
  if (result.ok) {
    setRepoWebhook(repoId, result.id, hookUrl);
    logControlEvent(
      "info",
      "webhooks",
      `webhook ${result.existing ? "found" : "created"} on “${repo.name}” (${hit.adapter.kind} #${result.id})`,
    );
  }
  return result;
}
