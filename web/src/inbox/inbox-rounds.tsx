// An interview's rounds bar (07/09). An interview is a SEQUENCE of rounds, and round 3 is decided
// knowing round 1's answers. Rereading a past round used to mean opening the channel, scrolling back
// and expanding it; here each round is a pill opening its own read page.
//
// Position makes the number: "Round 2" is the item's rank, computed by the server from `task_id` +
// `created_at` (server/src/inbox/inbox-question.ts). No position column, which would need upkeep and
// break the first time a round arrives out of sequence.
//
// Three distinct states: the CURRENT round in accent, a still OPEN round in amber, others neutral.
// Without the second, two open rounds would not say which to look at.
import type { ReactElement, ReactNode } from "react";
import type { InboxRound } from "../api/inbox.js";
import { INBOX_STATUS } from "../api/inbox.js";
import { Label } from "../ui/text.js";
import { Stack } from "../ui/flex.js";
import { INBOX_TEXT } from "./text.js";
import "./inbox-rounds.css";

const T = INBOX_TEXT.question;

export interface RoundLinkRender {
  (
    round: InboxRound,
    props: { className: string; children: ReactNode; "aria-current"?: "page" },
  ): ReactElement;
}

export function InboxRounds({
  rounds,
  currentId,
  render,
}: {
  rounds: readonly InboxRound[];
  currentId: string;
  /** The caller provides its `<Link>`: this module does not know the router, so stories need none. */
  render?: RoundLinkRender;
}) {
  // A one-round interview has no bar: a single pill pointing at the current page teaches nothing.
  if (rounds.length < 2) return null;
  return (
    <Stack gap={6} className="inbox-rounds">
      <Label as="p">{T.roundsLabel}</Label>
      <div className="inbox-rounds-list">
        {rounds.map((round, i) => {
          const current = round.id === currentId;
          const open = round.status === INBOX_STATUS.open;
          const text = open
            ? T.roundPillOpen(i + 1, round.answeredCount, round.fieldCount)
            : T.roundPill(i + 1, round.fieldCount);
          const props = {
            className: "inbox-rounds-pill",
            "data-state": current ? "current" : open ? "open" : "done",
            children: text,
            ...(current ? { "aria-current": "page" as const } : {}),
          };
          // The CURRENT round is not a link: a link to the current page is a click doing nothing,
          // announced by screen readers as a destination.
          return current || !render ? <span key={round.id} {...props} /> : render(round, props);
        })}
      </div>
    </Stack>
  );
}
