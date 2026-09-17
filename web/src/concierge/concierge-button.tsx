// The concierge in the bar: a panel, and a page (nav slice 10).
//
// The hover panel stays, and it is not a compromise: it is the quick question from anywhere, the
// page is where you come back to, like the inbox badge and the inbox. The panel keeps the current
// conversation's address so two questions in a row follow on server side, and its footer leads to
// the page.
//
// On click, not on hover: `ui/popover` documents both modes, hover is a preview, click an explicit
// opening. A conversation is not a preview, and a surface opening as you pass mostly opens when
// you did not want it.
import { useRef, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, MessageCircleQuestionMark } from "lucide-react";
import { conciergeApi } from "../api/concierge.js";
import { Link as UiLink } from "../ui/link.js";
import { Popover } from "../ui/popover.js";
import { ConciergePanel } from "./concierge-panel.js";
import { CONCIERGE_TEXT } from "./text.js";
import "./concierge-button.css";

/** The hover panel footer: the step to the page. A slot with a default, not a hard `<Link>`: the
 *  story workshop mounts a router without the app tree (`.storybook/preview.tsx`), and an unknown
 *  destination would break the story. */
function ToPage() {
  return (
    <UiLink render={(p) => <Link to="/concierge" {...p} />} className="concierge-to-page">
      {CONCIERGE_TEXT.toPage}
      <ArrowUpRight size={12} aria-hidden="true" />
    </UiLink>
  );
}

export function ConciergeButton({
  ask,
  pageLink = <ToPage />,
}: {
  /** Injectable for stories and tests: they must not reach the network. */
  ask?: (message: string) => Promise<string>;
  pageLink?: ReactNode;
}) {
  // The address of the conversation opened from the bar. A `ref`, not state: nobody reads it at
  // render, it only makes the next question join the same conversation.
  const conversationId = useRef<string | null>(null);

  const askServer = (message: string): Promise<string> =>
    conciergeApi.ask(message, conversationId.current).then((r) => {
      conversationId.current = r.conversationId;
      return r.reply;
    });

  return (
    <Popover
      label={CONCIERGE_TEXT.panelTitle}
      side="bottom"
      align="end"
      className="concierge-pop"
      triggerClassName="concierge-button"
      trigger={<MessageCircleQuestionMark size={17} />}
    >
      <ConciergePanel onAsk={ask ?? askServer} footer={pageLink} />
    </Popover>
  );
}
