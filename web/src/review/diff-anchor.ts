// A pre-review comment's ANCHOR (v33), the concept batch 32 missed.
//
// In a unified diff a line number ALONE designates nothing: removed line 74 (old side) and added
// line 74 (new side) are two lines, and the screen opened its editor and showed the comment under
// both (operator finding, 24/08). An anchor is a PAIR (side, line).
//
// A context line exists on both sides: it is anchored on "new", the only side the agent will find
// on its branch.
import type { ChangeData } from "react-diff-view";
import type { ReviewComment } from "../api/review.js";
import { REVIEW_SIDE, type ReviewSide } from "../api/review.js";

export type Side = ReviewSide;
export type Anchor = { side: Side; line: number };

export function changeAnchor(change: ChangeData): Anchor {
  if (change.type === "delete") return { side: REVIEW_SIDE.old, line: change.lineNumber };
  if (change.type === "insert") return { side: REVIEW_SIDE.new, line: change.lineNumber };
  return { side: REVIEW_SIDE.new, line: change.newLineNumber };
}

/** The selected range, anchored on its LAST line as on GitHub. Shift-click only extends WITHIN ONE
 *  SIDE: a range straddling old and new means nothing to the agent, who only rereads its branch. */
export type Selection = { repo: string; path: string; side: Side; from: number; to: number };

export const spanOf = (s: Selection) => ({
  start: Math.min(s.from, s.to),
  end: Math.max(s.from, s.to),
});

export function selectionCovers(sel: Selection | null, path: string, a: Anchor): boolean {
  if (!sel || sel.path !== path || sel.side !== a.side) return false;
  const { start, end } = spanOf(sel);
  return a.line >= start && a.line <= end;
}

/** Comments anchored ON this line: a range shows under its last line, never repeated on each line
 *  it covers. */
export function commentsAt(comments: ReviewComment[], path: string, a: Anchor): ReviewComment[] {
  return comments.filter((c) => c.filePath === path && c.side === a.side && c.line === a.line);
}

/** True if the line is INSIDE a commented range (without being its anchor), to tint it so the
 *  comment's extent shows without repeating it. */
export function withinCommented(comments: ReviewComment[], path: string, a: Anchor): boolean {
  return comments.some(
    (c) =>
      c.filePath === path &&
      c.side === a.side &&
      c.startLine !== null &&
      a.line >= c.startLine &&
      a.line < c.line,
  );
}
