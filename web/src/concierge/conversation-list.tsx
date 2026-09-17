// The conversations: what you asked, still there. They live on `concierge_turns`, server side.
//
// Pure presentation: it neither queries the API nor navigates; the screen passes `onOpen`. It
// reuses `ui/list` rather than invent a twelfth way to write a list row.
import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import type { ConciergeConversation } from "../api/concierge.js";
import { humanDuration } from "../ui/duration.js";
import { Empty } from "../ui/empty.js";
import { List, ListItem } from "../ui/list.js";
import { Caption } from "../ui/text.js";
import { CONCIERGE_TEXT } from "./text.js";

export function ConversationList({
  conversations,
  selectedId = null,
  now,
  onOpen,
}: {
  conversations: ConciergeConversation[];
  selectedId?: string | null;
  /** Injectable for stories: "2 h ago" must not depend on the current time. */
  now?: number;
  onOpen: (id: string) => void;
}) {
  // Frozen at mount: `Date.now()` during render is impure (oxlint react/purity).
  const [mounted] = useState(() => Date.now());
  const at = now ?? mounted;
  const t = CONCIERGE_TEXT.conversations;
  if (conversations.length === 0) {
    return (
      <Empty variant="panel" art="cleared" title={t.empty.title}>
        {t.empty.body}
      </Empty>
    );
  }
  return (
    <List label={t.title}>
      {conversations.map((c) => (
        <ListItem
          key={c.id}
          as="button"
          selected={c.id === selectedId}
          onClick={() => onOpen(c.id)}
          leading={<MessagesSquare size={15} aria-hidden="true" />}
          // A conversation opened by the situation report has no question yet: say so rather than
          // render a row with an empty title that looks broken.
          title={c.title || t.untitled}
          meta={
            <Caption>
              {t.turns(c.turnCount)} · {humanDuration(at - c.updatedAt)}
            </Caption>
          }
        />
      ))}
    </List>
  );
}
