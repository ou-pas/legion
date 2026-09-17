// Git identity of agent commits (v19), per project, with a sane default.
//
// Two columns on `projects`, not the global `settings` key/value store: it is a project setting like
// `defaultModel`, read at each session launch from the row `buildSpec` already loads.
//
// The default ("Legion" / "legion@local") is unchanged. Fixing GitHub attribution needs a real
// address of an account GitHub can link, which the server cannot guess; this setting lets the
// operator provide it.
//
// Absence never blocks a launch (in the spirit of preflight.ts: refuse only what is certain). Refusal
// happens only when the setting is written (validateGitAuthorEmail, from the /api/projects routes),
// where a useful message can be shown, never in the container where `git commit` would fail unread.

export const DEFAULT_GIT_AUTHOR_NAME = "Legion";
export const DEFAULT_GIT_AUTHOR_EMAIL = "legion@local";

export interface GitAuthor {
  name: string;
  email: string;
}

// Not a full RFC 5322 regex: just enough to refuse, in the form with a 400, what would break the git
// ident (control character, no @, empty or dotless domain).
const EMAIL_RE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/** `null` means valid; otherwise the message to return as is with a 400. */
export function validateGitAuthorEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "the email cannot be empty";
  if (/[\r\n\t]/.test(email)) return "the email cannot contain a line break or a tab";
  if (!EMAIL_RE.test(trimmed))
    return `“${trimmed}” does not have the shape of an email address (name@domain.tld)`;
  return null;
}

/** `null` means valid. The name is free (unicode, spaces); only characters that would break the git
 *  ident line ("Name <email>") are refused. */
export function validateGitAuthorName(name: string): string | null {
  if (!name.trim()) return "the name cannot be empty";
  if (/[\r\n<>]/.test(name)) return "the name cannot contain a line break or < >";
  return null;
}

/** The effective identity for `buildSpec`: the columns if set and non-blank, else the default. No
 *  validation: it happened on write. */
export function resolveGitAuthor(project: {
  gitAuthorName?: string | null;
  gitAuthorEmail?: string | null;
}): GitAuthor {
  return {
    name: project.gitAuthorName?.trim() || DEFAULT_GIT_AUTHOR_NAME,
    email: project.gitAuthorEmail?.trim() || DEFAULT_GIT_AUTHOR_EMAIL,
  };
}
