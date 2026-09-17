// What a repository URL must be to enter the database.
//
// Two checks, applied to different inputs (08/09). The host allowlist from the 05/09 audit guarded
// all three creation doors; now it guards one. At the other two the operator types the URL and picks
// the forge in a menu, and that act is the authorisation: it names the host and the token to present.
// Also requiring a `LEGION_FORGE_HOSTS` entry on the server, with a restart, was two acts for one
// decision.
//
// Its cost, measured on 08/09 on framagit.org: three repositories declared "gitlab", a GITLAB_TOKEN
// granted, and a clone dying on "could not read Username" because the variable was never set (the
// repositories predated the allowlist, so nothing had asked for it).
//
// Still guarded: crate import (`assertImportedRepoUrlAllowed`), the only input whose URL does not
// come from the UI. There the allowlist makes sense, since whoever writes the file is not whoever
// writes the list.
//
// Pure. Refusal order is the order messages need: transport first ("not a repository URL"), then
// credentials ("this one leaks"), host last. The reverse would answer "unreadable host" to `ftp://`,
// true and useless.
import { forgeHostRefusal, isSshRepoUrl } from "../integrations/forge.js";

export type RepoUrlVerdict = { ok: true; url: string } | { ok: false; error: string };

/** The cleaned URL or the reason to refuse it, never an exception: callers answer with a 400 or an
 *  import message, not a stack. */
export function assertRepoUrlAllowed(raw: string): RepoUrlVerdict {
  const url = raw.trim();
  if (!url) return { ok: false, error: "repo url required" };
  // Two transports (02/09): https (the token goes through the credential store) or SSH
  // (`git@host:path`, `ssh://…`, covered by the project key).
  if (!url.startsWith("https://") && !isSshRepoUrl(url))
    return { ok: false, error: "https:// or SSH repo url required (git@host:path, ssh://…)" };
  if (url.startsWith("https://")) {
    // A URL carrying credentials (`https://user:ghp_xxx@github.com/...`) went into `git clone` argv
    // in the container, and Node's "Command failed: …" prefix copied it as is into the session error
    // event, readable on screen. Git redacts; we leaked. (The `git@` of an SSH URL is the protocol,
    // not a credential.)
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `unreadable url: ${url}` };
    }
    if (parsed.username || parsed.password)
      return {
        ok: false,
        error: "the URL must carry no credential — the token goes through the credential store",
      };
  }
  return { ok: true, url };
}

/** The same URL, coming from a file (`POST /api/crate/import`). A crate is written on another
 *  machine, so its content is not an operator act: the host is checked against
 *  `LEGION_FORGE_HOSTS`, the only place that list still decides anything.
 *
 *  A separate function rather than a flag: the caller needing the check names it, and nobody gains
 *  or loses it by flipping a boolean from afar. */
export function assertImportedRepoUrlAllowed(raw: string): RepoUrlVerdict {
  const checked = assertRepoUrlAllowed(raw);
  if (!checked.ok) return checked;
  const hostRefusal = forgeHostRefusal(checked.url);
  if (hostRefusal) return { ok: false, error: hostRefusal };
  return checked;
}
