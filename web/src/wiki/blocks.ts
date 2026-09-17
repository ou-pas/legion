// Splitting a wiki page into blocks, and the list of its sections.
//
// Both live here on purpose: the anchor column must name exactly the headings the renderer shows,
// with the same ids. A second parser would drift at the first syntax change, and the symptom would
// be a shared link landing in the wrong place, which nobody sees in development.
//
// The block loop itself lives in `ui/markdown-blocks.ts` since 06/09. Only the two wiki-specific
// blocks and the section vocabulary remain here.

import { toBlocks as toCoreBlocks, type BlockRule, type CoreBlock } from "../ui/markdown-blocks.js";

const QUOTE = /^>\s?/;
const RULE = /^(-{3,}|\*{3,})\s*$/;

export type Block = CoreBlock | { kind: "quote"; lines: string[] } | { kind: "hr" };

type WikiBlock = { kind: "quote"; lines: string[] } | { kind: "hr" };

/** Horizontal rule: one line, nothing follows. */
const ruleRule: BlockRule<WikiBlock> = {
  test: (line) => RULE.test(line),
  consume: (_lines, i) => ({ block: { kind: "hr" }, next: i + 1 }),
};

/** Quote: all consecutive `>`-prefixed lines, prefix removed. */
const quoteRule: BlockRule<WikiBlock> = {
  test: (line) => QUOTE.test(line),
  consume(lines, i) {
    const buf: string[] = [];
    let n = i;
    while (n < lines.length && QUOTE.test(lines[n] ?? "")) {
      buf.push((lines[n] ?? "").replace(QUOTE, ""));
      n += 1;
    }
    return { block: { kind: "quote", lines: buf }, next: n };
  },
};

export function toBlocks(text: string): Block[] {
  return toCoreBlocks<WikiBlock>(text.split("\n"), [ruleRule, quoteRule]);
}

/** The H1 opens the page in the screen header: rendering it again in the body would duplicate the
 *  title. */
export function withoutLeadingH1(blocks: Block[]): Block[] {
  return blocks[0]?.kind === "h" && blocks[0].level === 1 ? blocks.slice(1) : blocks;
}

export interface WikiSection {
  /** Block position in the rendered page: the renderer finds the id through it. */
  index: number;
  id: string;
  title: string;
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const EXTLINK = /\[([^\]]+)\]\([^\s)]+\)/g;

/** A heading's plain text: shown in the column and transliterated. A heading can carry code
 *  (`--w-anchors`), bold, sometimes a wikilink. */
function plain(text: string): string {
  return text
    .replace(WIKILINK, (_m, raw: string) => (raw.split("|").pop() ?? "").trim())
    .replace(EXTLINK, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/** A section id is derived from its heading because that is what gets shared: a position counter
 *  would change with every paragraph inserted above and break links already sent. */
function slug(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "section";
}

/** A page's sections: the body's top-level headings, in order.
 *
 *  Subheadings are left out: at two levels the column becomes a second table of contents, which
 *  the rail already is for pages. */
export function sectionsFromBlocks(blocks: readonly Block[]): WikiSection[] {
  const seen = new Map<string, number>();
  const out: WikiSection[] = [];
  blocks.forEach((b, index) => {
    if (b.kind !== "h" || b.level > 2) return;
    const title = plain(b.text);
    const base = slug(title);
    // Two identical headings in a page are possible. Without this suffix both anchors point at the
    // first one.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ index, id: n === 1 ? base : `${base}-${n}`, title });
  });
  return out;
}

/** The top-of-page id. A section like the others for the anchor column: it carries the page
 *  title, is active until a heading is passed, and gives a shareable link to the start, since the
 *  intro belongs to no `##`. The prefix avoids colliding with a heading of the same name; the
 *  French value stays because shared links already carry it. */
export const WIKI_TOP_ID = "wiki-haut-de-page";

export function sectionsOf(content: string): WikiSection[] {
  return sectionsFromBlocks(withoutLeadingH1(toBlocks(content)));
}
