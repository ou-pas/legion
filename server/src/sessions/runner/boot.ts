// How the spec reaches the container WITHOUT going through its environment.
//
// `docker run` used to receive `-e LEGION_SPEC=<the whole spec as JSON>`: the auth token, the
// agent's granted secrets and the MCP server headers (secrets already resolved) were readable by
// any `docker inspect` for the container's whole life.
//
// Now the container only receives a URL and a single-use nonce: it fetches its spec at startup
// and the entry disappears on first read, so what `docker inspect` shows is a spent token.
// If nobody reads the nonce (a container that never starts), it stays valid until it expires,
// hence the short TTL.
import { randomBytes } from "node:crypto";

/** The container fetches its spec within a second of starting. One minute covers a slow
 *  `docker run` (image pull, internal network to create) without leaving entries lying around. */
const TTL_MS = 60_000;

interface Staged {
  sessionId: string;
  spec: unknown;
  at: number;
}

const staged = new Map<string, Staged>();

/** Called on every stage: without a container to consume them (`docker run` failed), expired
 *  entries would pile up silently in memory. */
function sweep(now: number): void {
  for (const [nonce, entry] of staged) if (now - entry.at > TTL_MS) staged.delete(nonce);
}

/** 32 bytes of cryptographic randomness: the nonce is the access token to the spec, not a
 *  readable identifier. */
export function stageSpec(sessionId: string, spec: unknown): string {
  const now = Date.now();
  sweep(now);
  const nonce = randomBytes(32).toString("base64url");
  staged.set(nonce, { sessionId, spec, at: now });
  return nonce;
}

/** `null` if the nonce is unknown, expired, already consumed, or belongs to another session:
 *  a nonce serves once, for one session. */
export function takeSpec(sessionId: string, nonce: string): unknown | null {
  const entry = staged.get(nonce);
  if (!entry) return null;
  // Consumed in every case: a nonce presented on the wrong session is burnt too, otherwise it
  // would stay usable after a probing attempt.
  staged.delete(nonce);
  if (entry.sessionId !== sessionId) return null;
  if (Date.now() - entry.at > TTL_MS) return null;
  return entry.spec;
}

/** For a container destroyed before it started. */
export function dropSpecs(sessionId: string): void {
  for (const [nonce, entry] of staged) if (entry.sessionId === sessionId) staged.delete(nonce);
}

/** For tests. */
export function stagedCount(): number {
  return staged.size;
}
