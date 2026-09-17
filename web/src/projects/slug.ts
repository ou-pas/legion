// The id a project name produces.
//
// Deliberate mirror of `server/src/projects/rename.ts`. The two halves share no code (same boundary
// as `hostAllowed` reproducing tinyproxy's filter), and the screen needs it to show the candidate
// before saving. A different formula here would show an id the server would not set, which is
// worse than showing nothing.
export function slugOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
