// Is the identity attributed? The check that was missing on 05/09.
//
// PR #573 of AcmeHQ/frontend carried six commits signed "Acme Agent <agents@acme.test>": a
// well-formed address, configured on the project, accepted by `validateGitAuthorEmail`, and linked
// to no GitHub account, so six anonymous commits next to the operator's name. "Is the identity
// configured?" would have seen nothing. The question is whether the forge will link the address to
// an account, and its only honest source is the verified addresses of the token owner
// (`listVerifiedEmails`).
//
// Three states, not two. "attributed" and "unlinked" are certainties; "unknown" means the forge did
// not answer (token without the scope, GitLab not exposing verification, no project secret).
// Collapsing "unknown" into "unlinked" would make a check with false positives, which people stop
// believing and then stop running.
//
// Not a gate, deliberately. A misattributed commit is cosmetic and fixable afterwards; a paused task
// stops work. A robot identity GitHub links to nothing is also a legitimate choice. It warns in two
// places: the project card (when setting it) and the inbox (at session launch, for projects set up
// before this check existed).
import { resolveForgeRepos } from "../integrations/forge-access.js";
import type { VerifiedEmail } from "../integrations/forge.js";
import { DEFAULT_GIT_AUTHOR_EMAIL, resolveGitAuthor } from "./git-identity.js";

export type GitIdentityStatus = "attributed" | "unlinked" | "unknown";

export interface GitIdentityCheck {
  status: GitIdentityStatus;
  /** The judged address, the one that will sign commits, default included. */
  email: string;
  /** The token owner's login, when it could be read. */
  login: string | null;
  /** A replacement address known to be attributed (the account's primary), when known. `null` when
   *  nothing is certain: a `users.noreply.github.com` address is not guessed, since its shape depends
   *  on account age and a wrong suggestion is worse than none.
   *
   *  Known divergence, unresolved (16/09). This field suggests the primary; `repo-adoption.ts` sets
   *  the `noreply` when the forge lists one, rightly: it attributes just as well and can never trigger
   *  "Block command line pushes that expose my email", which would reject a push after the session
   *  worked. Aligning this one changes a message on the project card and an inbox notice: a separate
   *  task. */
  suggestion: string | null;
  /** Why it is unknown, or what is wrong when unlinked. A sentence displayable as is. `null` when
   *  all is well. */
  reason: string | null;
}

/** The judgement, with no network or database: everything is passed in, so both directions are
 *  testable without a real token. */
export function judgeGitIdentity(input: {
  email: string;
  login: string | null;
  /** `null` means the forge did not say. See the header: not an empty list. */
  verifiedEmails: VerifiedEmail[] | null;
}): GitIdentityCheck {
  const email = input.email.trim();
  const login = input.login;
  const primary =
    input.verifiedEmails?.find((e) => e.primary)?.email ?? input.verifiedEmails?.[0]?.email ?? null;
  const suggestion = primary && primary.toLowerCase() !== email.toLowerCase() ? primary : null;

  // The default never claimed to be attributed: no forge query or token needed to flag it.
  if (!email || email.toLowerCase() === DEFAULT_GIT_AUTHOR_EMAIL) {
    return {
      status: "unlinked",
      email: email || DEFAULT_GIT_AUTHOR_EMAIL,
      login,
      suggestion,
      reason: `the project git identity is still the default (${DEFAULT_GIT_AUTHOR_EMAIL}): the forge will attribute the commits to nobody`,
    };
  }

  if (input.verifiedEmails === null) {
    return {
      status: "unknown",
      email,
      login,
      suggestion: null,
      reason:
        "the forge did not give the account's verified addresses (a token without the right to read them, or a forge that does not expose them) — there is no way to tell whether the commits will be attributed",
    };
  }

  if (input.verifiedEmails.some((e) => e.email.toLowerCase() === email.toLowerCase())) {
    return { status: "attributed", email, login, suggestion: null, reason: null };
  }

  return {
    status: "unlinked",
    email,
    login,
    suggestion,
    reason: login
      ? `“${email}” is not a verified address of account ${login}: the commits will not be attached to it`
      : `“${email}” is not a verified address of the account that owns the token: the commits will not be attached to it`,
  };
}

/** The same judgement, wired to the forge of the project's first resolved repository.
 *
 *  First repository only: the token is resolved per forge, not per repository (`resolveForgeRepos`),
 *  so asking for ten repositories would ask the same account ten times. A project mixing two forges
 *  is judged on the first; the worst case is one warning fewer, never a false one. */
export async function checkProjectGitIdentity(project: {
  id: string;
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
}): Promise<GitIdentityCheck> {
  const email = resolveGitAuthor(project).email;
  const { resolved } = resolveForgeRepos(project.id, undefined, 1);
  const target = resolved[0];
  if (!target) {
    // No queryable repository (none, or no secret): judge what is possible (the default) and
    // abstain on the rest.
    return judgeGitIdentity({ email, login: null, verifiedEmails: null });
  }
  // Known defect, not fixed, and visible (round 2, 16/09); counterpart of the note in
  // `integrations/gitlab.ts`.
  //
  // `getTokenOwnerLogin` takes no instance host, unlike `listRepos`. On GitLab it always goes to
  // `gitlab.com`, so a self-hosted instance (framagit, an internal GitLab) presents its token where
  // it is worthless: `login` is `null`, `listVerifiedEmails` is `null` on GitLab anyway, and the
  // verdict is "unknown". Always, not once: the project card permanently says it cannot tell,
  // on a perfectly configured project, and a permanent "unknown" stops being read.
  //
  // Fixing it means opening the signature of `getTokenOwnerLogin`, shared by three callers: a task
  // of its own.
  const [login, verifiedEmails] = await Promise.all([
    target.adapter.getTokenOwnerLogin(target.token).catch(() => null),
    target.adapter.listVerifiedEmails(target.token).catch(() => null),
  ]);
  return judgeGitIdentity({ email, login, verifiedEmails });
}

/** What was already reported, per project and address: changing the address reopens the right to
 *  warn. In memory on purpose: a restart warns once more, the right default for a warning that may
 *  have been missed. */
const warned = new Set<string>();

/** The launch warning. The project card only speaks to whoever opens it, and the faulty project is
 *  exactly the one nobody reopens.
 *
 *  Neither awaited nor blocking: the caller does `void warnIfGitIdentityUnlinked(...)`. A starting
 *  session must not depend on the forge API, and a misattributed commit can be fixed afterwards. */
export async function warnIfGitIdentityUnlinked(
  project: {
    id: string;
    name?: string;
    gitAuthorName?: string | null;
    gitAuthorEmail?: string | null;
  },
  addNotice: (body: string, kind?: string) => void,
): Promise<void> {
  const key = `${project.id}:${resolveGitAuthor(project).email}`;
  if (warned.has(key)) return;
  let verdict: GitIdentityCheck;
  try {
    verdict = await checkProjectGitIdentity(project);
  } catch {
    return; // A failing warning breaks nothing.
  }
  // Certainties only. "unknown" shows on the project card, where there is room to say why; as a
  // notice it would be noise nobody can clear.
  if (verdict.status !== "unlinked") return;
  warned.add(key);
  const where = project.name ? `Project “${project.name}”: ` : "";
  const fix = verdict.suggestion
    ? ` An attributed address is available on this account: ${verdict.suggestion}.`
    : "";
  addNotice(
    `${where}${verdict.reason}.${fix} Set it under “Git identity of commits”, on the project page.`,
    "warn",
  );
}
