// An agent-dropped artifact's type, decided by its extension: no byte sniffing for files of a few
// hundred KB (the artifacts pipeline is our object storage, operator decision 02/09, no MinIO).
// Moved out of the task routes ("artifacts accept binary" slice): a route translates an HTTP
// request, it does not decide what a file is; that rule is a domain fact, testable without Hono.
//
// `kind` tells what a browser can preview safely:
// - "text"   : proven rendering (sandboxed iframe, see tasks/routes/artifacts.ts), html/md/txt/json/svg/csv.
// - "image"  : <img>, never executable, never served as text.
// - "binary" : neither, offered as a download, never rendered inline.
//
// `.svg` stays "text", not "image": it is XML that can carry a `<script>`, and the existing
// rendering (iframe `sandbox="allow-scripts"` without `allow-same-origin`) is already the right
// confinement; an `<img src=svg>` would only make it inert for a preview use the sandbox already
// covers (review P3 #2, an invariant not reopened here).
import path from "node:path";

export type ArtifactKind = "text" | "image" | "binary";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8", // Chrome does not render text/markdown in an iframe (review P3 #7)
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const TEXT_EXT = new Set([".html", ".md", ".txt", ".json", ".svg", ".csv"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** Content-type to serve. `application/octet-stream` for anything unrecognised, never `text/html`
 *  by default: a binary with an unknown extension must never be interpreted as markup by the
 *  browser. */
export function artifactMimeType(name: string): string {
  return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

export function artifactKind(name: string): ArtifactKind {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXT.has(ext)) return "text";
  if (IMAGE_EXT.has(ext)) return "image";
  return "binary";
}
