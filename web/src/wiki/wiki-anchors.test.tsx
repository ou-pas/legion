// What the anchor column must hold: the right list, shareable ids, and above all a text position
// that does not depend on it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sectionsOf } from "./blocks.js";
import { WikiAnchors, WikiSheet } from "./wiki-anchors.js";

afterEach(cleanup);

const PAGE = [
  "# The page",
  "",
  "An introduction, with no heading above it.",
  "",
  "## The container dies while waiting",
  "",
  "### A subheading, which is not a section",
  "",
  "## The network is not isolated",
  "",
  "```sh",
  "## this is a shell comment, not a heading",
  "```",
  "",
  "## A task can wait for several tasks",
].join("\n");

describe("a page's sections", () => {
  it("takes the section headings, in text order", () => {
    expect(sectionsOf(PAGE).map((s) => s.title)).toEqual([
      "The container dies while waiting",
      "The network is not isolated",
      "A task can wait for several tasks",
    ]);
  });

  it("leaves out the opening H1, subheadings, and what is inside a code block", () => {
    const titles = sectionsOf(PAGE).map((s) => s.title);
    expect(titles).not.toContain("The page");
    expect(titles).not.toContain("A subheading, which is not a section");
    expect(titles.some((t) => t.includes("shell comment"))).toBe(false);
  });

  it("derives an id from the heading: that is what gets shared, not a number", () => {
    // Accented on purpose: the slug strips diacritics.
    expect(sectionsOf("## The réseau is not cloisonné")[0]!.id).toBe("the-reseau-is-not-cloisonne");
    // A heading carries code and bold: the id starts from the plain text.
    expect(sectionsOf("## The `--w-anchors` token and **the measure**")[0]).toMatchObject({
      title: "The --w-anchors token and the measure",
      id: "the-w-anchors-token-and-the-measure",
    });
    // A heading without a single Latin letter still gets a usable id.
    expect(sectionsOf("## ???")[0]!.id).toBe("section");
  });

  it("disambiguates two identical headings with a suffix", () => {
    // Without it, both anchors point at the first section.
    const ids = sectionsOf("## What we learned\n\n## Other\n\n## What we learned").map((s) => s.id);
    expect(ids).toEqual(["what-we-learned", "other", "what-we-learned-2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the column", () => {
  it("renders a real link per section, to its section's id", () => {
    const { container } = render(<WikiAnchors sections={sectionsOf(PAGE)} />);
    const links = [...container.querySelectorAll("a")];
    // Real links: a button calling scrollIntoView cannot be copied with a right click.
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      sectionsOf(PAGE).map((s) => `#${s.id}`),
    );
    expect(links.map((a) => a.textContent)).toEqual(sectionsOf(PAGE).map((s) => s.title));
  });

  it("renders nothing when the page has no heading", () => {
    const { container } = render(
      <WikiAnchors sections={sectionsOf("Three paragraphs, zero sections.")} />,
    );
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders the list from a single heading", () => {
    // A threshold of three existed for half a day: of 24 corpus pages only one fell below it, and
    // it lost two useful sections.
    const { container } = render(<WikiAnchors sections={sectionsOf("## Who it is for")} />);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

/** The clause that matters: going from a long page to a short one must not move the text. jsdom
 *  does no layout, so both halves of the invariant are checked: the rendered structure is the same
 *  on both sides, and the grid carrying it is unconditional. */
describe("the text position does not depend on the column", () => {
  const sheet = (md: string) => {
    const { container } = render(
      <WikiSheet sections={sectionsOf(md)}>
        <p>The body text.</p>
      </WikiSheet>,
    );
    return container.querySelector(".dm-wiki-sheet")!;
  };

  it("renders the same box, body in the first column, with or without sections", () => {
    const withSections = sheet(PAGE);
    const without = sheet("Three paragraphs, zero sections.");
    // Same attributes on the sheet: no conditional class or `data-` that would change the grid.
    expect(without.getAttributeNames().sort()).toEqual(withSections.getAttributeNames().sort());
    expect(without.className).toBe(withSections.className);
    // The body is the first child on both sides, so always in the same track.
    expect(without.firstElementChild!.className).toBe("dm-wiki-body");
    expect(withSections.firstElementChild!.className).toBe("dm-wiki-body");
    expect(without.children).toHaveLength(1);
    expect(withSections.children).toHaveLength(2);
  });

  it("declares the grid once, unconditionally", () => {
    // From the package root: vitest gives no file-scheme `import.meta.url`.
    const css = readFileSync(join(process.cwd(), "src/wiki/wiki.css"), "utf8");
    const rules = css.match(/\.dm-wiki-sheet[^{]*\{[^}]*\}/g) ?? [];
    // One rule defines the tracks outside media queries; the second is the narrow fallback, where
    // the column goes away for everyone, not depending on page content.
    const tracked = rules.filter((r) => r.includes("grid-template-columns"));
    expect(tracked).toHaveLength(2);
    expect(rules.some((r) => /\[data-|\.dm-wiki-sheet\./.test(r.split("{")[0]!))).toBe(false);
  });
});
