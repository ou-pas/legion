// Legion's wiki (25/08, operator's request): the product documentation, readable in the panel
// the way Obsidian would read it.
//
// The source is the repo, not the database. `docs/wiki/*.md` is versioned, opens as-is in
// Obsidian, and is already in every session's clone: an agent wondering what an approval gate is
// has the answer without a tool built to serve it. Docs next to the code age with it, under review.
//
// Read-only: this module never writes to docs/.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const WIKI_DIR = join(ROOT, "docs", "wiki");

// No page size cap (08/09). The old 200 KB cap silently truncated content we write ourselves,
// under review, and its `truncated` flag was read by no screen. Do not bring it back.

export interface WikiLink {
  /** The normalised target slug. */
  target: string;
  /** The displayed text: `[[target|label]]`. */
  label: string;
  /** `[[target]]` has no label, so the renderer shows the target page's title, not its path.
   *  Without this flag it cannot be told apart from a deliberate `[[target|target]]`, and the
   *  whole corpus read as raw slugs. */
  hasLabel: boolean;
}

export interface WikiPage {
  slug: string;
  title: string;
  /** The page's folder, "" at the root: it groups the table of contents. */
  section: string;
  content: string;
  bytes: number;
  links: WikiLink[];
}

export interface WikiEntry {
  slug: string;
  title: string;
  section: string;
  bytes: number;
}

/** `docs/wiki/Concepts/Agent.md` → `concepts/agent`. */
export function slugOf(relPath: string): string {
  return relPath
    .slice(0, relPath.length - extname(relPath).length)
    .split(sep)
    .join("/")
    .toLowerCase();
}

/** The first `# title` of the file, else the file name. No frontmatter: the H1 is the title. */
export function titleOf(content: string, relPath: string): string {
  const h1 = /^#\s+(.+)$/m.exec(content);
  return (h1?.[1] ?? basename(relPath, extname(relPath))).trim();
}

/** `[[target]]` and `[[target|label]]`. The target is normalised like a slug so that
 *  `[[Concepts/Agent]]`, `[[concepts/agent]]` and `[[Agent]]` all lead to the same place. */
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function parseLinks(content: string): WikiLink[] {
  const out: WikiLink[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(WIKILINK)) {
    const raw = m[1]!.trim();
    const target = raw.split(sep).join("/").toLowerCase();
    const hasLabel = m[2] !== undefined;
    const label = (m[2] ?? raw).trim();
    const key = `${target}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ target, label, hasLabel });
  }
  return out;
}

function walk(dir: string, base: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else if (extname(name).toLowerCase() === ".md") out.push(relative(base, full));
  }
  return out;
}

function readPage(relPath: string): WikiPage {
  const full = join(WIKI_DIR, relPath);
  const raw = readFileSync(full, "utf8");
  const dir = dirname(relPath);
  return {
    slug: slugOf(relPath),
    title: titleOf(raw, relPath),
    section: dir === "." ? "" : dir.split(sep).join("/"),
    content: raw,
    bytes: Buffer.byteLength(raw, "utf8"),
    links: parseLinks(raw),
  };
}

/** A missing folder is an empty wiki, not an error. */
export function listPages(): WikiEntry[] {
  if (!existsSync(WIKI_DIR)) return [];
  return walk(WIKI_DIR, WIKI_DIR).map((rel) => {
    const p = readPage(rel);
    return { slug: p.slug, title: p.title, section: p.section, bytes: p.bytes };
  });
}

/** Resolves a link target to a real page: exact path first, then the bare name, so `[[Agent]]`
 *  finds `concepts/agent`. Ambiguity is settled by alphabetical order: arbitrary but stable,
 *  which beats a link whose destination depends on the file system. */
export function resolveSlug(target: string, entries: WikiEntry[]): WikiEntry | null {
  const want = target.replace(/^\/+|\/+$/g, "").toLowerCase();
  return (
    entries.find((e) => e.slug === want) ??
    entries.find((e) => e.slug.split("/").pop() === want) ??
    null
  );
}

export function backlinksOf(slug: string, entries: WikiEntry[]): WikiEntry[] {
  const out: WikiEntry[] = [];
  for (const e of entries) {
    if (e.slug === slug) continue;
    const page = getPage(e.slug);
    if (!page) continue;
    if (page.links.some((l) => resolveSlug(l.target, entries)?.slug === slug)) out.push(e);
  }
  return out;
}

/** The path is looked up in the inventory, never concatenated from the caller's input: path
 *  traversal (`../../.env`) is impossible by construction rather than by a filter someone forgets. */
export function getPage(slug: string): WikiPage | null {
  if (!existsSync(WIKI_DIR)) return null;
  const want = slug.replace(/^\/+|\/+$/g, "").toLowerCase();
  const rel = walk(WIKI_DIR, WIKI_DIR).find((r) => slugOf(r) === want);
  return rel ? readPage(rel) : null;
}
