// What a client may send to the `connections` context.
//
// `strictObject` everywhere, as in `projects/schemas.ts`: an unknown key is refused by name. Silently
// dropping it would close the hole too, but the UI would believe its request was heard as sent.
import { z } from "zod";
import { AUTH_FORMATS, TOKEN_ORIGIN, TOKEN_ORIGINS, type TokenOrigin } from "./providers.js";

/** What the provider asked for besides the token, as the UI sent it: an opaque string for everything
 *  that carries it. Only the descriptor knows what it is (`ProviderField`); only shape is validated.
 *
 *  No content constraint, same reasoning as for the token: validating would require knowing what it
 *  is, and a regex here would someday refuse a good value for a provider it does not know. Optional
 *  because two providers out of three ask for nothing; the descriptor refuses absence when it
 *  matters, naming what is missing. */
const ProviderFieldValue = z.string().optional();

export const StartConnectionBody = z.strictObject({
  projectId: z.string().min(1),
  field: ProviderFieldValue,
});

export const PollConnectionBody = z.strictObject({
  flowId: z.string().min(1),
});

/** Adopting a pasted token: the second acquisition path, and the domain's only request body carrying
 *  a secret. It enters, is encrypted, and never comes back out (response, log, error message).
 *
 *  No shape constraint on the token: each provider has its own and they change. The provider decides,
 *  at the probe. */
export const AdoptConnectionBody = z.strictObject({
  projectId: z.string().min(1),
  token: z.string().min(1),
  field: ProviderFieldValue,
});

/** What the OAuth callback reads from its query: untrusted input from a browser returning from a
 *  third party.
 *
 *  `state` is required; `code` on a granted authorisation, `error` on a refusal, never both. A
 *  provider may send neither: an unreadable return, not a server error.
 *
 *  `strictObject` on an object we compose ourselves: the route picks the three parameters by name
 *  rather than passing the whole query, so a provider adding a parameter tomorrow breaks nothing. */
export const CallbackQuery = z.strictObject({
  state: z.string().min(1),
  code: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

/** The content of `secrets.metadata`. Validated on read, not only on write: the column is text, and a
 *  row written by an earlier version must be refused cleanly rather than pass as `any`.
 *
 *  `.passthrough()` rather than `strictObject`, unlike the bodies above: this column exists so other
 *  integrations can attach what they need. Known fields are typed; unknown ones survive.
 *
 *  No secret enters here: that is the column's invariant. The refresh token lives encrypted in
 *  `refresh_ciphertext`. */
export const CredentialMetadata = z
  .object({
    /** The provider name, not `z.enum(PROVIDERS)`: strictness backfired. `.optional()` does not
     *  excuse a present out-of-enum value, so an unknown `provider` rejected the whole `metadata`,
     *  `account`, `scopes` and `origin` included. The most strictly validated field was the one
     *  nobody reads in production, and it threw away those everyone reads.
     *
     *  A provider leaving `PROVIDERS` would make its rows lose account and scopes and show "unknown
     *  origin". A string, then: a trace of what wrote the row, not a decision key. */
    provider: z.string().optional(),
    /** Epoch milliseconds. Absent means no known expiry. */
    expiresAt: z.number().int().nonnegative().optional(),
    /** The account the token belongs to, as the UI shows it. */
    account: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    /** Where the token comes from. Absent from rows written before 15/09; see `credentialOrigin`. */
    origin: z.enum(TOKEN_ORIGINS).optional(),
    /** The header format this token uses, as observed by the probe. Absent means `bearer` (see
     *  `AUTH_FORMAT`), covering every row written before the field existed: those came from an
     *  authorisation flow.
     *
     *  Not a secret: it is the envelope's shape, not its content.
     *
     *  Strict like `origin`, not lax like `provider`: both are written by us from a closed enum,
     *  whereas `provider` is a trace that can outlive a provider's removal. */
    authFormat: z.enum(AUTH_FORMATS).optional(),
    /** When the provider answered, epoch milliseconds. Absent means it never did.
     *
     *  The only field saying "we asked". Adoption (`adopt-pasted.ts`) used to recognise a probed row by
     *  `account` or `scopes`, but a probe finding neither is normal (Linear always returns `scopes:
     *  null`, an account without name or email returns `account: null`). Such a row went through again
     *  on every `make adopt-tokens`, forever repeating itself.
     *
     *  It does not replace `account` or `scopes`: it says we asked, not what we learned. */
    probedAt: z.number().int().nonnegative().optional(),
    /** What the provider asked for besides the token, under the key it named (`ProviderField`).
     *  Today only `host` for GitLab, the instance this token belongs to.
     *
     *  Here because it is a property of the connection, not the server: the operator has a project on
     *  framagit and nothing on gitlab.com, and the global `LEGION_GITLAB_HOST` refused one of the two
     *  tokens of anyone with two.
     *
     *  No secret enters: this column is clear JSON. An instance URL or an app id already travel in
     *  public URLs.
     *
     *  A named bag rather than flat keys: `account`, `scopes` and `origin` live at the root, and a
     *  provider naming its field `account` would silently overwrite them. */
    fields: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type CredentialMetadata = z.infer<typeof CredentialMetadata>;

/** The `metadata` column read as what it is: text from the database, possibly written by an earlier
 *  version.
 *
 *  Two ways of knowing nothing, not equivalent. `undefined`: no column, nobody ever wrote anything.
 *  `null`: there is one and it does not read (broken JSON, unrecognised shape). The first allows an
 *  inference (see `credentialOrigin`), the second forbids any. */
export function readCredentialMetadata(raw: string | null): CredentialMetadata | null | undefined {
  if (!raw) return undefined;
  try {
    const parsed = CredentialMetadata.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Where a `secrets` row's token comes from, or `null` when it cannot be told.
 *
 *  No `metadata` (`undefined`) means pasted: a secret set by hand in the Secrets card; "pasted" is the
 *  only fact available.
 *
 *  Unreadable `metadata` (`null`) means unknown, and above all not "pasted". Until correction round
 *  1 both cases merged: a granted credential whose JSON no longer parsed showed "Pasted token: the
 *  provider does not know Legion exists", a false sentence presented as fact.
 *
 *  `metadata` without `origin` means granted, an archaeological reading: before 15/09 `storeToken` was
 *  the only writer of this column, so a row carrying one came from a flow. Both sides write the field
 *  explicitly since; this fallback only serves existing connections. */
export function credentialOrigin(
  metadata: CredentialMetadata | null | undefined,
): TokenOrigin | null {
  if (metadata === undefined) return TOKEN_ORIGIN.pasted;
  if (metadata === null) return null;
  return metadata.origin ?? TOKEN_ORIGIN.granted;
}
