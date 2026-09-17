// The single path to a provider token's value.
//
// Before it, `decryptSecret` was called from eight independent places, each with its own resolution.
// None was a choke point: an expiring token breaks them separately, and there was nowhere a renewal
// could happen.
//
// Renewal is not implemented yet: `refreshCiphertext` is stored (Linear) but nothing reads it, so this
// is still a plain traversal. When it comes, it goes in `resolve`, in one place.
//
// It lives in `connections/`, not `shared/`, because `shared/` is a leaf and renewal will call the
// provider adapters.
import { decryptSecret } from "../shared/crypto.js";
import { secretRowFor } from "./connections-store.js";
import { authorizationHeader } from "./providers.js";
import { readCredentialMetadata } from "./schemas.js";

/** The choke point, internal: both public reads derive from it, so renewal will be added once and
 *  both inherit it.
 *
 *  `metadata` comes out raw on purpose (round 1). A first version validated it here, making
 *  `freshSecret` (so `git.ts` and `forge-access.ts`, which only want the value) pay a `JSON.parse`
 *  plus a zod `safeParse`. The callers that need it parse it themselves. */
function resolve(
  projectId: string,
  name: string,
): { value: string; metadata: string | null } | null {
  const row = secretRowFor(projectId, name);
  if (!row) return null;
  // Renewal would go here: if `row.refreshCiphertext` is set and the expiry in `row.metadata` has
  // passed, renew, rewrite the row, and return the new value.
  return { value: decryptSecret(row.ciphertext), metadata: row.metadata };
}

/** The clear value of the named secret, or `null` if there is none.
 *
 *  `null` rather than an exception: a project can mix two forges, and one missing secret must not
 *  prevent reading the other (the rule `resolveForgeRepos` already applies upstream). */
export function freshSecret(projectId: string, name: string): string | null {
  return resolve(projectId, name)?.value ?? null;
}

/** The `Authorization` header value for this secret, in the format the probe observed at acquisition
 *  (`AUTH_FORMAT`).
 *
 *  For tokens whose format cannot be inferred from their name. Linear is the only one today: it takes
 *  a raw personal key and a `Bearer` OAuth token, and until 15/09 `integrations/linear.ts` put `Bearer`
 *  on both, so a pasted key passed adoption then failed every request. Callers whose provider has one
 *  form keep reading `freshSecret`. */
export function freshAuthorization(projectId: string, name: string): string | null {
  const found = resolve(projectId, name);
  if (!found) return null;
  const metadata = readCredentialMetadata(found.metadata);
  return authorizationHeader(found.value, metadata?.authFormat);
}

/** The token and what the provider asked for besides it, under the key it named.
 *
 *  Same pattern as `freshAuthorization`: one reader needing a `metadata` fact next to the token, read
 *  through this choke point. Here it is the instance: a framagit token and a gitlab.com token cannot
 *  be presented to the same host, and discovering a connection's repositories requires knowing whom
 *  to ask. Without it the tile knows which instance granted the token, while the Repositories screen
 *  asks gitlab.com and gets an empty list.
 *
 *  `fields` is an opaque bag here; the caller names the key, because the provider declared it
 *  (`ProviderField.name`). */
export function freshSecretWithField(
  projectId: string,
  name: string,
  /** `null` means this provider asks for nothing; the token comes back alone. */
  field: string | null,
): { value: string; field: string | null } | null {
  const found = resolve(projectId, name);
  if (!found) return null;
  if (field === null) return { value: found.value, field: null };
  const metadata = readCredentialMetadata(found.metadata);
  return { value: found.value, field: metadata?.fields?.[field] || null };
}
