// Rendering a wiki page. Separate from `ui/markdownish.tsx` on purpose: Markdownish renders an
// agent note (headings flattened to bold, external links only, one rhythm). A doc page needs two
// things a note does not: a real heading hierarchy (people skim, looking for a section) and
// [[wikilinks]], which mean nothing outside this domain.
//
// A dead link is rendered, struck through and flagged: not an error but the list of pages still to
// write. Swallowing it would hide the one thing a wiki produces on its own.
//
// Block parsing lives in `blocks.ts`: the anchor column needs the same headings and ids as this
// renderer, and two parsers would drift.
import { Fragment, type ReactNode } from "react";
import { Link as RouterLink } from "@tanstack/react-router";
import { type WikiLink } from "../api/wiki.js";
import { sectionsFromBlocks, toBlocks, withoutLeadingH1 } from "./blocks.js";
import { WIKI_TEXT } from "./text.js";
import { CodeBlock } from "../ui/code.js";
import { Link } from "../ui/link.js";
import { Prose } from "../ui/prose.js";
import { safeHref } from "../ui/safe-href.js";
import "./wiki.css";

const WIKILINK = /\[\[[^\]]+\]\]/;
const SPLIT = /(\[\[[^\]]+\]\]|`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g;

/** A `[[target|label]]` wikilink: a link when the target exists, dead text when it does not, and
 *  that dead text is what makes a renamed page visible.
 *
 *  Matched on the target: the server may have replaced a `[[target]]` label with the target page's
 *  title, so the link text no longer matches what is written. */
function wikiLink(raw: string, links: readonly WikiLink[], key: number): ReactNode {
  const [target = "", label] = raw.split("|");
  const id = target.trim().toLowerCase();
  const written = label?.trim();
  const link =
    (written ? links.find((l) => l.target === id && l.label === written) : undefined) ??
    links.find((l) => l.target === id);
  const shown = written ?? link?.label ?? target.trim();
  if (!link?.resolved)
    return (
      <span key={key} className="dm-wiki-dead" title={WIKI_TEXT.deadLink}>
        {shown}
      </span>
    );
  return (
    <RouterLink
      key={key}
      to="/wiki/$slug"
      params={{ slug: link.resolved }}
      className="dm-wiki-link"
    >
      {shown}
    </RouterLink>
  );
}

function inline(text: string, links: readonly WikiLink[]): ReactNode {
  return text.split(SPLIT).map((part, i) => {
    if (WIKILINK.test(part)) return wikiLink(part.slice(2, -2), links, i);
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <b key={i}>{inline(part.slice(2, -2), links)}</b>;
    const ext = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    // Same filter as Markdownish: a wiki page is written under review, but agents that could edit
    // it also read it. A refused scheme stays text (05/09).
    const href = ext && safeHref(ext[2] ?? "");
    if (ext && href)
      return (
        <Link key={i} href={href} target="_blank" rel="noreferrer">
          {ext[1]}
        </Link>
      );
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function WikiMarkdown({ content, links }: { content: string; links: readonly WikiLink[] }) {
  const blocks = withoutLeadingH1(toBlocks(content));
  // Ids are set on the rendered headings, not only listed beside them: without them `#section`
  // leads nowhere.
  const ids = new Map(sectionsFromBlocks(blocks).map((s) => [s.index, s.id]));
  // The only prose keeping the reading measure: a wiki page is long text read in one go. Explicit
  // since `Prose` defaults to `full`.
  return (
    <Prose size="md" width="measure" className="dm-wiki-prose">
      {blocks.map((b, i) => {
        if (b.kind === "code")
          return (
            <CodeBlock key={i} label={b.lang || "code"}>
              {b.lines.join("\n")}
            </CodeBlock>
          );
        if (b.kind === "hr") return <hr key={i} className="dm-wiki-rule" />;
        if (b.kind === "h") {
          // Two visible levels are enough for a doc page: section and subsection. Beyond that the
          // page wants splitting, and the rendering does not hide it.
          const cls = b.level <= 2 ? "dm-wiki-h2" : "dm-wiki-h3";
          return (
            <p key={i} id={ids.get(i)} className={cls}>
              {inline(b.text, links)}
            </p>
          );
        }
        if (b.kind === "quote")
          return (
            <blockquote key={i} className="dm-wiki-quote">
              {inline(b.lines.join(" "), links)}
            </blockquote>
          );
        // A paragraph's lines are joined with a space. Markdown files are hand-wrapped around 95
        // columns: rendering those breaks would make staircase text.
        if (b.kind === "p") return <p key={i}>{inline(b.lines.join(" "), links)}</p>;
        const items = b.items.map((item, j) => <li key={j}>{inline(item, links)}</li>);
        return b.kind === "ul" ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
      })}
    </Prose>
  );
}
