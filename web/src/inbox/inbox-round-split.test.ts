// Splitting a round into questions (07/09). A `FormSpec` is a flat block sequence; direction A
// (inbox-decoupes.html) reads it as SCREENS: a field and the argument before it. This pins where each
// block goes, since a misplaced block changes what the human reads before deciding: the first version
// put question 1's argument into a collapsed "context", and its instruction vanished.
import { describe, expect, it } from "vitest";
import type { FormBlock, FormField } from "../api/inbox.js";
import { splitRound, stripHeading, type ContentBlock } from "./inbox-round-split.js";

const md = (text: string): ContentBlock => ({ kind: "markdown", text });
const svg: ContentBlock = { kind: "svg", svg: "<svg viewBox='0 0 1 1'/>" };
const field = (id: string): FormField => ({ id, label: id, type: "text" });
const f = (id: string): FormBlock => ({ kind: "field", field: field(id) });

describe("splitRound", () => {
  it("each field takes what precedes it, including blocks before the first field", () => {
    const round = splitRound({
      blocks: [md("look at the panel"), svg, f("a"), md("for b"), svg, f("b")],
    });
    expect(round.questions.map((q) => q.field.id)).toEqual(["a", "b"]);
    expect(round.questions[0]?.argument).toEqual([md("look at the panel"), svg]);
    expect(round.questions[1]?.argument).toEqual([md("for b"), svg]);
  });

  it("blocks AFTER the last field stay with the last question", () => {
    const round = splitRound({ blocks: [f("a"), f("b"), md("thanks")] });
    expect(round.questions[1]?.argument).toEqual([md("thanks")]);
  });

  it("a single field: one question carrying everything", () => {
    const round = splitRound({ blocks: [md("before"), f("only"), md("after")] });
    expect(round.questions).toHaveLength(1);
    expect(round.questions[0]?.argument).toEqual([md("before"), md("after")]);
  });

  it("zero fields: no question; the server refuses this spec, the screen does not crash", () => {
    expect(splitRound({ blocks: [md("alone")] }).questions).toEqual([]);
  });

  it('the agent heading line ("## 3. …") is stripped from the argument: the screen already has the title', () => {
    const round = splitRound({
      blocks: [md("## 1. An observation\n\nIn the editor, select…"), f("a")],
    });
    expect(round.questions[0]?.argument).toEqual([md("In the editor, select…")]);
  });
});

describe("stripHeading", () => {
  it("without a leading heading, nothing moves", () => {
    expect(stripHeading([md("no heading"), svg])).toEqual([md("no heading"), svg]);
    expect(stripHeading([svg, md("# after an svg")])).toEqual([svg, md("# after an svg")]);
  });
  it("a block reduced to its heading disappears", () => {
    expect(stripHeading([md("## 6. How we prove it"), svg])).toEqual([svg]);
    expect(stripHeading([md("  \n### alone")])).toEqual([]);
  });
  it("a `#` not opening a heading (no space) is text", () => {
    expect(stripHeading([md("#123 is a ticket")])).toEqual([md("#123 is a ticket")]);
  });
});
