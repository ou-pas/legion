// A PR's merge state: never a bare dash when unknown. The three states are named (`merge-state.ts`),
// "not known yet" as much as the other two. Full explanation on hover (title) and for screen readers
// (.ui-sr).
import { Check, GitMergeConflict, LoaderCircle } from "lucide-react";
import type { MergeState } from "../api/review.js";
import { MERGE_STATE_LABEL, MERGE_STATE_TITLE, MERGE_STATE_TONE } from "./merge-state.js";
import "./merge-state-chip.css";

function mergeStateIcon(state: MergeState) {
  switch (state) {
    case "mergeable":
      return <Check size={13} />;
    // A dedicated conflict icon, the shape GitHub/Linear use for this state, not a generic cross.
    case "conflict":
      return <GitMergeConflict size={13} />;
    case "unknown":
      return <LoaderCircle size={13} className="merge-state-chip-spinner" />;
  }
}

export function MergeStateChip({ state }: { state: MergeState }) {
  const tone = MERGE_STATE_TONE[state];
  const label = MERGE_STATE_LABEL[state];
  const title = MERGE_STATE_TITLE[state];

  return (
    <span className={`merge-state-chip merge-state-chip-${tone}`} title={title}>
      {mergeStateIcon(state)}
      {label}
      <span className="ui-sr">{title}</span>
    </span>
  );
}
