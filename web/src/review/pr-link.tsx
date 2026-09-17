// A pull request and its state: a design system StatusChip, a drawn external-link icon, and the repo
// as literal data.
import { ExternalLink, GitPullRequest } from "lucide-react";
import type { ChipState } from "../ui/chip.js";
import { StatusChip, Tag } from "../ui/chip.js";
import { Link } from "../ui/link.js";
import { PrStateChip } from "./pr-state-chip.js";
import { REVIEW_TEXT } from "./text.js";
import "./pr-link.css";
import type { PrState } from "../api/review.js";

/** What the link announces. Named `PrLinkState` because it used to be `PrState`, shadowing the
 *  forge's `PrState` (used by the `prState` prop), which was enough for an automated replace to mix
 *  them up. Three families of `open`, three names.
 *
 *  `attached` = attached to the task · `created` = just created · `existing` = already there. */
export const PR_LINK_STATE = {
  attached: "attached",
  created: "created",
  existing: "existing",
} as const;
export type PrLinkState = (typeof PR_LINK_STATE)[keyof typeof PR_LINK_STATE];

const STATE: Record<PrLinkState, { label: string; chip: ChipState }> = {
  attached: { label: REVIEW_TEXT.pr.open, chip: "ok" },
  created: { label: REVIEW_TEXT.pr.created, chip: "ok" },
  existing: { label: REVIEW_TEXT.pr.existing, chip: "idle" },
};

export function PrLink({
  repo,
  url,
  state = PR_LINK_STATE.attached,
  className,
  prState,
}: {
  /** Pushed repo name: one PR per repo. */
  repo: string;
  url: string;
  state?: PrLinkState;
  className?: string;
  /** The PR's real state at the forge (replaces the fixed label when given). v26+ */
  prState?: PrState;
}) {
  return (
    <Link
      variant="plain"
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className={["dm-pr", className].filter(Boolean).join(" ")}
    >
      <GitPullRequest size={13} aria-hidden="true" className="dm-pr-icon" />
      <span className="dm-pr-label">PR</span>
      <Tag>{repo}</Tag>
      {/* The forge's real state, once known, wins over the creation label: PrStateChip has its OWN
          icon and colour per state (pr-state-chip.tsx); through the generic StatusChip, open and
          merged rendered in the SAME colour. */}
      {prState ? (
        <PrStateChip state={prState} />
      ) : (
        <StatusChip state={STATE[state].chip} size="sm" dot={false}>
          {STATE[state].label}
        </StatusChip>
      )}
      <ExternalLink size={12} aria-hidden="true" className="dm-pr-out" />
    </Link>
  );
}
