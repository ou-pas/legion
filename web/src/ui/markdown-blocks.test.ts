// The core alone (06/09), no React, no rendering. Both callers have their own rendering tests; what
// they do not cover is what the loop does in odd cases: an unclosed code fence, an extension that
// looks at the next line and backs off, an indented line in a list. Exactly what drifted when the
// loop existed twice.
import { describe, expect, it } from "vitest";
import { toBlocks, type BlockRule } from "./markdown-blocks.js";

const cut = (text: string) => toBlocks(text.split("\n"));

describe("toBlocks — shared blocks", () => {
  it("recognises heading, bullets, numbers, code and paragraph", () => {
    expect(cut("## Title\n\n- one\n- two\n\n1. a\n2. b\n\n```ts\nx\n```\n\nsome text")).toEqual([
      { kind: "h", level: 2, text: "Title" },
      { kind: "ul", items: ["one", "two"] },
      { kind: "ol", items: ["a", "b"] },
      { kind: "code", lang: "ts", lines: ["x"] },
      { kind: "p", lines: ["some text"] },
    ]);
  });

  it("keeps the heading level, from 1 to 6", () => {
    expect(cut("# one\n###### six")).toEqual([
      { kind: "h", level: 1, text: "one" },
      { kind: "h", level: 6, text: "six" },
    ]);
  });

  it("joins consecutive paragraph lines and breaks at the first block", () => {
    expect(cut("one\ntwo\n- bullet")).toEqual([
      { kind: "p", lines: ["one", "two"] },
      { kind: "ul", items: ["bullet"] },
    ]);
  });

  it("closes a code block nobody closed instead of silently swallowing the rest", () => {
    expect(cut("```sh\nmake gates\nmore")).toEqual([
      { kind: "code", lang: "sh", lines: ["make gates", "more"] },
    ]);
  });

  it("flattens a nested list: indentation does not make a second level", () => {
    expect(cut("- one\n  - sub\n- two")).toEqual([{ kind: "ul", items: ["one", "sub", "two"] }]);
  });

  it("renders empty text with no block, and does not loop on blank lines", () => {
    expect(cut("")).toEqual([]);
    expect(cut("\n\n\n")).toEqual([]);
  });
});

// The test extension looks at the next line before claiming, like `markdownish`'s GFM table.
// Without that line, the same first line must fall back to a paragraph.
interface Pair {
  kind: "pair";
  a: string;
  b: string;
}
const pairRule: BlockRule<Pair> = {
  test: (line, { lines, i }) => line.startsWith("@") && (lines[i + 1] ?? "").startsWith("="),
  consume: (lines, i) => ({
    block: { kind: "pair", a: lines[i] ?? "", b: lines[i + 1] ?? "" },
    next: i + 2,
  }),
};

describe("toBlocks — extensions", () => {
  it("lets the extension consume several lines and resumes where it says", () => {
    expect(toBlocks("@x\n=1\nnext".split("\n"), [pairRule])).toEqual([
      { kind: "pair", a: "@x", b: "=1" },
      { kind: "p", lines: ["next"] },
    ]);
  });

  it("without its second line, the first stays visible text", () => {
    expect(toBlocks("@x\nnext".split("\n"), [pairRule])).toEqual([
      { kind: "p", lines: ["@x", "next"] },
    ]);
  });

  it("breaks a running paragraph when the extension recognises itself", () => {
    expect(toBlocks("before\n@x\n=1".split("\n"), [pairRule])).toEqual([
      { kind: "p", lines: ["before"] },
      { kind: "pair", a: "@x", b: "=1" },
    ]);
  });

  it("runs before heading and bullets: the order of both original versions", () => {
    const first: BlockRule<{ kind: "first" }> = {
      test: (line) => line.startsWith("#"),
      consume: (_lines, i) => ({ block: { kind: "first" }, next: i + 1 }),
    };
    expect(toBlocks("# title".split("\n"), [first])).toEqual([{ kind: "first" }]);
  });
});
