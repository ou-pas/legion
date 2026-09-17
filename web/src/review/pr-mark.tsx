// The PR as an icon (04/09, verdict redesign): shape and colour say the state, the number says which,
// the word is no longer shown. Open, mergeable, repo name: three pills side by side for one fact, and
// the operator had stopped reading them.
//
// Shapes and colours are GitHub's (open green, merged purple, closed red, draft grey), where the
// operator learned them and finds them again on click. Tints are tokens (`--pr-*`, two themes), not
// copied hex values: the dark theme carries the light variants, as GitHub does.
//
// Colour alone is not enough for those who cannot tell it apart (WCAG 1.4.1): the WORD stays in the
// tooltip and accessible name, and the shape changes per state too.
import {
  GitMerge,
  GitMergeConflict,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { PR_STATE, type MergeState, type PrState } from "../api/review.js";
import { Link } from "../ui/link.js";
import { REVIEW_TEXT } from "./text.js";
import "./pr-mark.css";

/** A PR or merge request number, read from its URL when the forge has not returned it yet
 *  (`/pull/112` on GitHub, `/merge_requests/7` on GitLab). `null` otherwise: no invented number. */
export function prNumberOf(url: string): number | null {
  const m = /\/(?:pull|merge_requests)\/(\d+)(?:[/?#]|$)/.exec(url);
  return m ? Number(m[1]) : null;
}

type Look = "open" | "merged" | "closed" | "draft" | "conflict";

/** Shape and tint come from the PR state and, when open, its merge state. A conflict wins over open:
 *  it is what asks for a gesture. */
function lookOf(state: PrState | undefined, mergeState: MergeState | undefined): Look {
  if (state === PR_STATE.merged) return "merged";
  if (state === PR_STATE.closed) return "closed";
  if (mergeState === "conflict") return "conflict";
  return "open";
}

const ICON: Record<Look, typeof GitPullRequest> = {
  open: GitPullRequest,
  merged: GitMerge,
  closed: GitPullRequestClosed,
  draft: GitPullRequestDraft,
  conflict: GitMergeConflict,
};

const WORD: Record<Look, string> = {
  open: REVIEW_TEXT.pr.stateOpen,
  merged: REVIEW_TEXT.pr.stateMerged,
  closed: REVIEW_TEXT.pr.stateClosed,
  draft: REVIEW_TEXT.pr.stateDraft,
  conflict: REVIEW_TEXT.merge.conflict,
};

export function PrMark({
  url,
  number,
  state,
  mergeState,
  repo,
  className,
}: {
  url: string;
  /** The forge's number; otherwise read from the URL. */
  number?: number | null;
  /** Unknown until the forge answers: drawn open, which is what it was. */
  state?: PrState;
  mergeState?: MergeState;
  /** Named only when the task pushes SEVERAL repositories, where it is what tells two marks apart. */
  repo?: string;
  className?: string;
}) {
  const look = lookOf(state, mergeState);
  const Icon = ICON[look];
  const n = number ?? prNumberOf(url);
  const word = WORD[look];
  const label =
    `${REVIEW_TEXT.pr.mark} ${n !== null ? `#${n}` : ""}${repo ? ` ${repo}` : ""} — ${word}`.replace(
      /\s+/g,
      " ",
    );
  return (
    <Link
      variant="plain"
      href={url}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className={["pr-mark", className].filter(Boolean).join(" ")}
      data-look={look}
    >
      <Icon size={15} aria-hidden="true" className="pr-mark-icon" />
      {repo && <span className="pr-mark-repo">{repo}</span>}
      {n !== null && <span className="pr-mark-number">#{n}</span>}
    </Link>
  );
}
