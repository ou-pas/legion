// What a repository URL says about itself: its host, and the project name it carries.
//
// Deliberate mirror of `server/src/integrations/forge.ts` (`hostOfRepoUrl`, `pathOfRepoUrl`), same
// boundary as `slug.ts` with `rename.ts`: the screen must show what will be inferred before saving,
// and cannot query a route for a label changing on every keystroke.
//
// Why the scp form is here though `guessForge` did without: the no-project screen offers one field,
// and `git@github.com:org/repo.git` is what a forge's clone button offers first. With `new URL()`
// alone this form returned `null`, and the derived line stayed empty on the most common URL.
const SCP = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/;

/** A repository URL's host, scp form included. `null` = unreadable. */
export function hostOfRepoUrl(url: string): string | null {
  const raw = url.trim();
  const scp = SCP.exec(raw);
  if (scp) return scp[1]!.toLowerCase();
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The project name inferred from a URL: the last path segment, without `.git`. What the human
 *  would have typed anyway, and the no-project screen's only field is the URL. */
export function projectNameFromUrl(url: string): string | null {
  const raw = url.trim();
  const scp = SCP.exec(raw);
  const path = scp ? scp[2]! : tryPath(raw);
  if (path === null) return null;
  const last = path
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean)
    .pop();
  return last ?? null;
}

function tryPath(raw: string): string | null {
  try {
    return new URL(raw).pathname;
  } catch {
    return null;
  }
}
