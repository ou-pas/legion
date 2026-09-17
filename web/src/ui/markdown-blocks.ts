// Lines → blocks splitting, written once (06/09).
//
// There were two, 90% identical: `ui/markdownish.tsx` (agent notes) and `wiki/blocks.ts` (docs).
// Same loop, same four recognisers (code fence, heading, bullet list, numbered list), same
// paragraph fallback; only extensions differed (GFM tables on one side, quotes and rules on the
// other). Two copies of a loop drift, and it shows on screen long after: a list that is a list in
// one renderer and not in the other.
//
// The core knows only what everyone writes; each caller declares its own blocks as rules. A rule
// sees the line and its position, because a GFM table is only recognised by the next line (the
// `|---|` separator). Whatever nobody recognises stays visible text: nothing is swallowed.

/** Blocks both renderers produce. Others are declared by the caller. */
export type CoreBlock =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; lang: string; lines: string[] };

/** Enough to look at the next line without consuming it. */
export interface BlockCursor {
  readonly lines: readonly string[];
  readonly i: number;
}

/** A block the core does not know. `consume` returns the block and the resume index, which must
 *  be strictly greater than `i` or the loop stalls. */
export interface BlockRule<B> {
  test(line: string, at: BlockCursor): boolean;
  consume(lines: readonly string[], i: number): { block: B; next: number };
}

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

// An out-of-range line is the empty string: it fails every test and ends every loop, which avoids
// a `!` per access under `noUncheckedIndexedAccess`.
const at = (lines: readonly string[], n: number): string => lines[n] ?? "";

/** What the core recognises itself, and which therefore interrupts a running paragraph. */
function startsCoreBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line);
}

/** Everything after the opening fence up to the closing one, or to the end of the text when it
 *  is missing. Nothing in between is reinterpreted. */
function takeFence(lines: readonly string[], i: number): { block: CoreBlock; next: number } {
  const lang = at(lines, i).slice(3).trim();
  const buf: string[] = [];
  let n = i + 1;
  while (n < lines.length && !FENCE.test(at(lines, n))) {
    buf.push(at(lines, n));
    n += 1;
  }
  return { block: { kind: "code", lang, lines: buf }, next: n + 1 };
}

/** Consecutive lines with the same marker, stripped of it. A bullet after a number therefore
 *  opens another list, which is what the screen shows. */
function takeList(lines: readonly string[], i: number): { block: CoreBlock; next: number } {
  const kind = BULLET.test(at(lines, i)) ? ("ul" as const) : ("ol" as const);
  const marker = kind === "ul" ? BULLET : NUMBERED;
  const items: string[] = [];
  let n = i;
  while (n < lines.length && marker.test(at(lines, n))) {
    items.push(at(lines, n).replace(marker, ""));
    n += 1;
  }
  return { block: { kind, items }, next: n };
}

/** Runs until something else starts: a blank line, a core block, or a caller-declared block. */
function takeParagraph(
  lines: readonly string[],
  i: number,
  isRule: (n: number) => boolean,
): { block: CoreBlock; next: number } {
  const buf: string[] = [];
  let n = i;
  while (n < lines.length && at(lines, n).trim() && !startsCoreBlock(at(lines, n)) && !isRule(n)) {
    buf.push(at(lines, n));
    n += 1;
  }
  return { block: { kind: "p", lines: buf }, next: n };
}

/** Rules run before heading and lists: the order both original versions had (a table, a rule and
 *  a quote all exclude heading and bullets, so this single order reproduces both behaviours). */
export function toBlocks<E>(
  lines: readonly string[],
  rules: readonly BlockRule<E>[] = [],
): Array<CoreBlock | E> {
  const ruleAt = (n: number) => rules.find((r) => r.test(at(lines, n), { lines, i: n }));
  const out: Array<CoreBlock | E> = [];
  let i = 0;
  while (i < lines.length) {
    const line = at(lines, i);
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const taken = takeAt(lines, i, ruleAt);
    out.push(taken.block);
    i = taken.next;
  }
  return out;
}

/** The block starting at `i`, whatever it is, and where to resume. The line is known non-empty
 *  and the paragraph is the fallback, so progress is guaranteed. */
function takeAt<E>(
  lines: readonly string[],
  i: number,
  ruleAt: (n: number) => BlockRule<E> | undefined,
): { block: CoreBlock | E; next: number } {
  const line = at(lines, i);
  if (FENCE.test(line)) return takeFence(lines, i);
  const rule = ruleAt(i);
  if (rule) return rule.consume(lines, i);
  const h = HEADING.exec(line);
  if (h) return { block: { kind: "h", level: (h[1] ?? "").length, text: h[2] ?? "" }, next: i + 1 };
  if (BULLET.test(line) || NUMBERED.test(line)) return takeList(lines, i);
  return takeParagraph(lines, i, (n) => ruleAt(n) !== undefined);
}
