// When a repository enters a project, what else should be filled in?
//
// The git identity is a consequence of the moment the project learns which forge it uses, not one
// more form step. It is filled when the first repository enters, not on a separate screen someone
// must remember to open, which is why this rule lives next to repositories.
//
// Pure: no database, network or secret, so both directions are testable without a real token. The
// counterpart of `judgeGitIdentity`: one observes, the other proposes.
import type { VerifiedEmail } from "../integrations/forge.js";
import {
  DEFAULT_GIT_AUTHOR_EMAIL,
  DEFAULT_GIT_AUTHOR_NAME,
  validateGitAuthorEmail,
  validateGitAuthorName,
} from "./git-identity.js";

/** A forge's noreply address: `46607170+ou-pas@users.noreply.github.com` and enterprise
 *  equivalents (`users.noreply.<host>`).
 *
 *  Recognised, never built. Its shape depends on account age (`git-identity-check.ts` refuses to
 *  derive it too), but GitHub always lists it in `/user/emails`, checked on 15/09 on the operator's
 *  account: `verified: true`, `primary: false`, next to the real address. Nothing to guess, only
 *  to spot in a list the forge wrote. */
const NOREPLY_DOMAIN = /^users\.noreply\./i;

function isNoreply(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return NOREPLY_DOMAIN.test(domain);
}

/** The git identity still at its default, both fields, not just the address.
 *
 *  Empty, blank or equal to the default is what `resolveGitAuthor` reads as "nothing chosen".
 *  Anything else is a choice, including a name alone: someone who set "Acme Agent" without touching
 *  the address decided something, and it is not undone.
 *
 *  Exported so the caller can give up before querying the forge: otherwise a project with a chosen
 *  identity would pay two network calls per added repository to get `null`. */
export function isIdentityAtDefault(current: {
  name: string | null;
  email: string | null;
}): boolean {
  const name = current.name?.trim() || DEFAULT_GIT_AUTHOR_NAME;
  const email = current.email?.trim() || DEFAULT_GIT_AUTHOR_EMAIL;
  return (
    name === DEFAULT_GIT_AUTHOR_NAME &&
    email.toLowerCase() === DEFAULT_GIT_AUTHOR_EMAIL.toLowerCase()
  );
}

/** The address that will sign commits, chosen among those the forge verified.
 *
 *  Noreply first (rule 2 below), then primary, then the first. `null` when there is nothing: neither
 *  a silent forge (`null`) nor an empty list gives an address known to be attributed. */
function addressToSign(verifiedEmails: VerifiedEmail[] | null): string | null {
  const verified = verifiedEmails ?? [];
  return (
    verified.find((e) => isNoreply(e.email))?.email ??
    verified.find((e) => e.primary)?.email ??
    verified[0]?.email ??
    null
  );
}

/** The git identity to set when a repository enters, or `null` if there is nothing to do.
 *
 *  Three rules:
 *
 *  1. Fill only if the identity is still the default. `git-identity-check.ts` holds that a robot
 *     identity the forge links to nothing is a legitimate choice. Overwriting an explicit choice
 *     would undo it silently while the operator was busy adding a repository.
 *  2. Prefer the noreply to the primary address. It attributes commits as well and can never
 *     trigger "Block command line pushes that expose my email", which would reject `git push` after
 *     the session worked. `checkProjectGitIdentity` suggests the primary today; that is the worse
 *     choice, and this does not align with it.
 *  3. The name falls back to `login` when `name` is null. Not an edge case: the operator's account
 *     has no display name (`name: null`, checked on 15/09).
 *
 *  If nothing comes back, nothing is set: a null list means the forge did not answer, an empty one
 *  means no verified address, and neither yields an address known to be attributed. Likewise with
 *  no name and no login. */
export function identityToAdopt(input: {
  current: { name: string | null; email: string | null };
  login: string | null;
  name: string | null;
  verifiedEmails: VerifiedEmail[] | null;
}): { name: string; email: string } | null {
  if (!isIdentityAtDefault(input.current)) return null;

  const email = addressToSign(input.verifiedEmails);
  if (!email) return null;

  const name = input.name?.trim() || input.login?.trim() || null;
  if (!name) return null;

  // Forge data is external and goes straight to the database without the form that would validate
  // it. So the same checks as a manual write (`validateGitAuthor*`), and refusal is `null`: better
  // set nothing than an ident line `git commit` would reject in a container, unread until the
  // session ends.
  if (validateGitAuthorName(name) !== null || validateGitAuthorEmail(email) !== null) return null;

  return { name, email };
}
