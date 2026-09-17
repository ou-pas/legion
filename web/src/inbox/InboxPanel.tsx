// The question register framing the board and the task page. Until 07/09 it mounted each question's
// WHOLE form: on the task page a six-question round pushed verdict, blockers and tabs off screen; on
// the board three open rounds put six thousand pixels above the lanes. It now mounts the CARD (as in
// the channel thread and the inbox list); the questionnaire lives on its page.
//
// It carries its own gesture on purpose: both callers did exactly the same (answer hook, frozen clock,
// page link), and copied props drift. The panel knows the router because it knows the questions;
// `pending-panel.tsx` must not (it lives in the bar, and its stories mount without a route tree).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { type InboxItem as InboxQuestion } from "../api/inbox.js";
import { useReplyInbox } from "../queries.js";
import { Stack } from "../ui/flex.js";
import { InboxCard } from "./inbox-card.js";

export function InboxPanel({
  items,
  projectId,
}: {
  items: InboxQuestion[];
  /** The screen's project, under which a question page lives. Items carry theirs (`item.projectId`),
   *  but a link built on the screen's project cannot leave the project being viewed. */
  projectId: string;
}) {
  const reply = useReplyInbox();
  // Frozen at mount: `Date.now()` during render is impure (oxlint react/purity). A question appearing is
  // mounted at that instant, so its wait starts from zero.
  const [now] = useState(() => Date.now());
  if (items.length === 0) return null;
  return (
    <Stack gap={10}>
      {items.map((item) => (
        <InboxCard
          key={item.id}
          item={item}
          now={now}
          pending={reply.isPending}
          onReply={(body) => reply.mutate({ id: item.id, body })}
          render={(props) => (
            <Link
              to="/p/$projectId/inbox/$inboxId"
              params={{ projectId, inboxId: item.id }}
              {...props}
            />
          )}
        />
      ))}
    </Stack>
  );
}
