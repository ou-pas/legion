// The operator session: what authorises the human API (13/09).
//
// `/api` used to be authorised by the caller's address. That stopped holding with multi-machine
// runners: an agent container on a runner machine leaves through its host, so it arrives as
// `100.x`, indistinguishable from the operator's browser. No address rule can separate two
// processes on one machine. Measured on 13/09: a `curl` from a runner machine got 200 on
// `/api/bootstrap` without presenting anything.
//
// The session is the abstraction, not the token. The guard asks "do you hold a valid session?",
// never "do you have the right token?". The token is the first way to get one; a security key
// (WebAuthn) will be the second once there is TLS. A guard comparing tokens would need reopening
// for every new way in.
//
// This token is not the agent session token (`sessions.callback_token`), which opens
// `/internal/sessions/<its id>` and nothing else. Two secrets, two scopes, no overlap. Everything
// depends on this one never entering a container: not the spec, not an env variable, not an
// `/internal` response, not `/workspace`.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createLogger } from "../shared/log.js";
import {
  deleteOperatorSession,
  insertOperatorSession,
  operatorSessionRow,
  operatorTokenHash,
  saveOperatorTokenHash,
  touchOperatorSession,
} from "./operator-store.js";

const log = createLogger("operator");

export const OPERATOR_COOKIE = "legion_operator";

/** How a session was obtained. `passkey` comes with WebAuthn; it is named already so the table
 *  does not have to change that day. */
export type OperatorMethod = "token" | "passkey";

/** 32 bytes cannot be guessed: rate limiting will be against noise, never the last line. */
const TOKEN_BYTES = 32;

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Constant-time comparison. An ordinary one stops at the first differing byte, so response time
 *  leaks how much prefix was right and the secret can be rebuilt byte by byte. Hashes are compared
 *  because they have a fixed length, so `timingSafeEqual` never throws on a size mismatch (which
 *  would be one more leak). */
function sameSecret(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hash(presented), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The instance token, created by the first boot that finds none.
 *
 *  Generated rather than read from an env variable: a fresh install must be safe without anyone
 *  thinking about it. A variable gets set "later", and "later" is exactly how the API stayed open.
 *
 *  The clear value is printed once, by the boot that creates it, and stored nowhere. If lost, it
 *  is regenerated with `resetOperatorToken`. */
export function ensureOperatorToken(): void {
  if (operatorTokenHash()) return;
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  saveOperatorTokenHash(hash(token));
  log.warn(
    "operator token created — copy it now, it will never be shown again:\n\n" + `    ${token}\n`,
  );
}

/** Regenerates the token and returns the clear value. Sessions already open stay valid: rotating
 *  the token does not close them, `closeSession` does. */
export function resetOperatorToken(): string {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  saveOperatorTokenHash(hash(token));
  return token;
}

export function tokenMatches(presented: string | undefined): boolean {
  const stored = operatorTokenHash();
  if (!stored || !presented) return false;
  return sameSecret(presented, stored);
}

/** The id is random and derived from nothing: a cookie must not lead back to the token. */
export function openSession(method: OperatorMethod, now = new Date()): string {
  const id = randomBytes(TOKEN_BYTES).toString("base64url");
  insertOperatorSession({ id, method, createdAt: now, lastSeenAt: now });
  return id;
}

export function closeSession(id: string): void {
  deleteOperatorSession(id);
}

/** Also updates `last_seen_at`, for a future sessions screen ("this browser, seen two minutes
 *  ago") and for expiring dormant sessions if that is ever wanted. */
export function sessionIsOpen(id: string | undefined, now = new Date()): boolean {
  if (!id) return false;
  const row = operatorSessionRow(id);
  if (!row) return false;
  touchOperatorSession(id, now);
  return true;
}
