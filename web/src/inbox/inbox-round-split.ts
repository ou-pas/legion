// A round read as screens (07/09, direction A of inbox-decoupes.html). The `FormSpec` is flat: per
// question, the argument then the field, as the interviewer writes ("## 1. …" then the field). The old
// screen rendered it as is, drowning the decision in its justification.
//
// This module only says which question each block belongs to: what precedes a field since the
// previous one (or the round start) is ITS argument; what follows the last field stays with the last
// question. Round context is NOT in the FormSpec: it is `item.evidence` and `item.impact`, collapsed by
// the inbox item (inbox-round-context.tsx). Pure, no React.
import type { FormBlock, FormField, FormSpec } from "../api/inbox.js";

/** A CONTENT block: markdown or SVG, never a field. */
export type ContentBlock = Exclude<FormBlock, { kind: "field" }>;

export type RoundQuestion = { field: FormField; argument: ContentBlock[] };
export type Round = { questions: RoundQuestion[] };

const HEADING = /^\s*#{1,6}\s/;

/** Strips the HEADING LINE opening an argument ("## 3. And when…"): the agent's numbering, which the
 *  screen already carries (question counter and `label` title). Otherwise two stacked titles. A block
 *  reduced to its heading disappears. */
export function stripHeading(blocks: readonly ContentBlock[]): ContentBlock[] {
  const [first, ...rest] = blocks;
  if (!first || first.kind !== "markdown") return [...blocks];
  const lines = first.text.split("\n");
  const at = lines.findIndex((l) => l.trim() !== "");
  if (at === -1 || !HEADING.test(lines[at] ?? "")) return [...blocks];
  const text = lines
    .slice(at + 1)
    .join("\n")
    .trim();
  return text ? [{ kind: "markdown", text }, ...rest] : rest;
}

export function splitRound(spec: FormSpec): Round {
  const questions: RoundQuestion[] = [];
  let pending: ContentBlock[] = [];
  for (const block of spec.blocks) {
    if (block.kind !== "field") {
      pending = [...pending, block];
      continue;
    }
    questions.push({ field: block.field, argument: pending });
    pending = [];
  }
  const last = questions.length - 1;
  return {
    questions: questions.map((q, i) => ({
      field: q.field,
      argument: stripHeading(i === last ? [...q.argument, ...pending] : q.argument),
    })),
  };
}
