// A PR's merge state vocabulary, shared by the task page PR tab (tasks/pr-tab.tsx) and the Reviews
// screen: the same review data shown in two places, never two readings that could diverge.
import type { MergeState } from "../api/review.js";
import type { ChipState } from "../ui/chip.js";
import { REVIEW_TEXT } from "./text.js";

export const MERGE_STATE_LABEL: Record<MergeState, string> = {
  mergeable: REVIEW_TEXT.merge.mergeable,
  conflict: REVIEW_TEXT.merge.conflict,
  unknown: REVIEW_TEXT.merge.unknown,
};

export const MERGE_STATE_TITLE: Record<MergeState, string> = {
  mergeable: REVIEW_TEXT.merge.mergeableTitle,
  conflict: REVIEW_TEXT.merge.conflictTitle,
  unknown: REVIEW_TEXT.merge.unknownTitle,
};

/** GitHub computes `mergeable` in the background: `null` while running, `true`/`false` once done
 *  ("you should check back later"). Reading it as "no conflict" would lie about an ongoing
 *  computation, so `"unknown"` takes `--wait` (a WAIT, not a problem). Only `"conflict"` takes `--bad`:
 *  it alone blocks the merge and asks for a gesture; `"mergeable"` takes `--ok`, like the open PR
 *  chip of `pr-link.tsx`. */
export const MERGE_STATE_TONE: Record<MergeState, ChipState> = {
  mergeable: "ok",
  conflict: "bad",
  unknown: "wait",
};
