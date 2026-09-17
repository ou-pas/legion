// The PR's real state at the forge, with the SAME icon convention as GitHub and Linear: one shape per
// state (not one shape recoloured) and its own colour: green = open, purple = merged, neutral =
// closed unmerged. Merged used to share open's colour, indistinguishable at a glance (operator
// feedback). Distinct from the MERGE state (mergeable/conflict/unknown), only shown on an open PR:
// see merge-state-chip.tsx.
import { GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { REVIEW_TEXT } from "./text.js";
import "./pr-state-chip.css";
import { PR_STATE, type PrState } from "../api/review.js";

function prStateIcon(state: PrState) {
  switch (state) {
    case PR_STATE.open:
      return <GitPullRequest size={13} />;
    case PR_STATE.merged:
      return <GitMerge size={13} />;
    case PR_STATE.closed:
      return <GitPullRequestClosed size={13} />;
  }
}

export function PrStateChip({ state }: { state: PrState }) {
  const toneMap: Record<PrState, "ok" | "merged" | "neutral"> = {
    open: "ok",
    merged: "merged",
    closed: "neutral",
  };
  const tone = toneMap[state];

  const labelMap: Record<PrState, string> = {
    open: REVIEW_TEXT.pr.stateOpen,
    merged: REVIEW_TEXT.pr.stateMerged,
    closed: REVIEW_TEXT.pr.stateClosed,
  };
  const label = labelMap[state];

  const titleMap: Record<PrState, string> = {
    open: REVIEW_TEXT.pr.stateOpenTitle,
    merged: REVIEW_TEXT.pr.stateMergedTitle,
    closed: REVIEW_TEXT.pr.stateClosedTitle,
  };
  const title = titleMap[state];

  return (
    <span className={`pr-state-chip pr-state-chip-${tone}`} title={title}>
      {prStateIcon(state)}
      {label}
      <span className="ui-sr">{title}</span>
    </span>
  );
}
