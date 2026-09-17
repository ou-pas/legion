// The section column of the open page, right of the text (direction-wiki-largeur, B).
//
// The rail lists pages; this column lists the sections of the one being read. That is what sets it
// apart from a second table of contents, and what earns the width the reading measure (72ch) left.
import { useEffect, useState, type ReactNode } from "react";
import { SidePanel } from "../ui/side-panel.js";
import { type WikiSection } from "./blocks.js";
import { WIKI_TEXT } from "./text.js";
import "./wiki.css";

/** The active anchor follows reading through intersection observation, never a scroll listener
 *  recomputing positions on every pixel.
 *
 *  The -70% bottom margin shrinks the observed zone to the top of the viewport: without it, the
 *  page's last heading stays visible to the bottom and so active forever.
 *
 *  Falling back to the first section when nothing is in the band is not a defect: at the top of a
 *  page you are above the first heading, which is what you are about to read. */
function useActiveSection(sections: readonly WikiSection[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  // A string as dependency: the array is rebuilt on every parent render, and the observer would
  // unmount/remount constantly if taken as is.
  const key = sections.map((s) => s.id).join("\n");
  useEffect(() => {
    const ids = key ? key.split("\n") : [];
    // jsdom has no IntersectionObserver: without this guard every test mounting the screen breaks.
    if (ids.length === 0 || typeof IntersectionObserver === "undefined") return;

    // The last section whose heading passed the reading line, not the first in a narrow top band.
    // The first version looked for headings in the top 30% and fell back to the first section
    // when there were none: right at the top, frozen on the first section everywhere else (seen in
    // Chrome on 29/08 scrolling an eleven-section article). Geometry always has an answer to "what
    // am I reading"; "which heading is in the band" does not.
    const line = () => {
      const root = document.querySelector(".dm-wiki-scroll");
      return (root ? root.getBoundingClientRect().top : 0) + LECTURE_OFFSET;
    };
    const recompute = () => {
      const root = document.querySelector(".dm-wiki-scroll");
      // At rest you are at the top, as a rule, not an approximation. Without it, a page with a
      // short intro has its first heading in the reading band before anything moved, and the
      // column pointed at the second entry (seen on concepts/agent, 30/08).
      if (!root || root.scrollTop <= 1) {
        setActive(ids[0] ?? null);
        return;
      }
      const y = line();
      let passed: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= y) passed = id;
      }
      // No heading passed: above the first one, which is what you are about to read.
      setActive(passed ?? ids[0] ?? null);
    };

    // The observer stays the trigger (free, and no per-pixel scroll listener); the geometry reread
    // on each batch gives the answer.
    const io = new IntersectionObserver(recompute, {
      root: document.querySelector(".dm-wiki-scroll"),
      // Staggered thresholds: a heading crossing the line triggers, even slowly.
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    recompute();
    return () => io.disconnect();
  }, [key]);
  return active ?? sections[0]?.id ?? null;
}

/** How far down the body a section counts as being read. Low enough that a heading at the edge
 *  does not switch the anchor before it is really on screen. */
const LECTURE_OFFSET = 96;

/** A received `#section` must open the page at the right place. The browser does it on load, but
 *  the wiki content arrives later, from a request, and by then the browser has given up. So the
 *  jump is replayed once, on arrival. */
function useHashLanding(key: string) {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    // `auto`, not `smooth`: arriving on a shared link is not a move within the page, and an
    // animated two-screen scroll is exactly what reduced motion forbids.
    document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [key]);
}

export function WikiAnchors({ sections }: { sections: readonly WikiSection[] }) {
  const active = useActiveSection(sections);
  useHashLanding(sections.map((s) => s.id).join("\n"));
  // Without headings the column renders nothing: an empty column would promise something. Its
  // place stays reserved by the grid (see WikiSheet); removing it would move the text.
  if (sections.length === 0) return null;
  return (
    // In a DS `SidePanel` (04/09, operator feedback: "a right panel like for tasks"): the same
    // full-height sheet as a task's panel.
    <SidePanel label={WIKI_TEXT.onThisPage}>
      <nav className="dm-wiki-anchors" aria-label={WIKI_TEXT.onThisPage}>
        <span className="dm-wiki-anchors-title">{WIKI_TEXT.onThisPage}</span>
        {sections.map((s) => (
          // Real links: a right click copies a section's address, and the browser does the jump
          // itself. A button calling scrollIntoView cannot be shared.
          <a
            key={s.id}
            href={`#${s.id}`}
            className="dm-wiki-anchor"
            aria-current={s.id === active ? "true" : undefined}
          >
            {s.title}
          </a>
        ))}
      </nav>
    </SidePanel>
  );
}

/** The grid that reserves the column's place, with or without sections.
 *
 *  A threshold below which the page narrowed existed for half a day on 29/08. Of 24 corpus pages
 *  only one had fewer than three headings, and there it hid two useful sections. Above all,
 *  narrowing moves the text sideways between a long and a short page. Reading stability comes
 *  before filling every pixel: the grid never changes, only its content.
 *
 *  The body is the first child, so always in the first column: that is what makes the text
 *  position independent of the column. */
export function WikiSheet({
  sections,
  children,
}: {
  sections: readonly WikiSection[];
  children: ReactNode;
}) {
  return (
    <div className="dm-wiki-sheet">
      <div className="dm-wiki-body">{children}</div>
      <WikiAnchors sections={sections} />
    </div>
  );
}
