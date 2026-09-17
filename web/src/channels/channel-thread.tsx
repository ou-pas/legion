// The thread: one source, two renderings (discussion mode spec, D9ter). A pane following the bottom,
// the pinned brief as first message, transcript turns, and three slots left to the composing screen.
//
// The task page Interview tab shows the SAME thread as the channel. Two implementations would drift
// (a round visible here and not there, two orders): the thread is composed, not copied.
import type { ReactNode } from "react";
import { Stack } from "../ui/flex.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { ChannelActionBand } from "./channel-action-band.js";
import { ChannelBrief } from "./channel-brief.js";
import { ChannelMessage } from "./channel-message.js";
import { ChannelStream } from "./channel-stream.js";
import { atTime } from "./clock.js";
import { CHANNELS_TEXT } from "./text.js";
import type { InboxHistoryEntry } from "../api/inbox.js";
import type { TaskEventSession } from "../api/task-history.js";
import type { Segment } from "./transcript.js";

export function ChannelThread({
  brief,
  briefAuthor,
  briefAt,
  segments,
  sessions,
  archive,
  agentName,
  operatorName,
  pending,
  notice,
  footer,
  size = "fill",
  label = CHANNELS_TEXT.stream.label,
  className,
}: {
  /** The task brief: the thread's first message, from the operator. */
  brief: string;
  briefAuthor: string;
  /** Brief timestamp (ms): the task's creation. */
  briefAt?: number;
  segments: Segment[];
  /** The task's sessions: the thread spans them all since 26/08, and an uncaptioned break would not
   *  say which one starts. */
  sessions?: TaskEventSession[];
  /** The task's inbox archive: what surrounded each past question. */
  archive?: InboxHistoryEntry[];
  agentName: string;
  operatorName: string;
  /** The open round's live node, rendered as the last turn; its `inboxId` shrinks the matching round
   *  to a pointer. Absent when the surface renders it elsewhere (the task page has its inbox register
   *  above the tabs, and duplicating it would make two forms for one question). */
  pending?: { inboxId: string; node: ReactNode };
  /** About the STREAM, not the conversation (SSE cut). */
  notice?: ReactNode;
  /** The decision taken where the work was read: approval gate, failed session. The caller builds it
   *  ONLY when there is something to decide: a node rendering `null` would still create the band. */
  footer?: ReactNode;
  /** `fill` takes the height the parent leaves (channels page, viewport height); `lg` caps it, as a
   *  tab panel in a scrolling page needs. */
  size?: "md" | "lg" | "fill";
  label?: string;
  className?: string;
}) {
  return (
    <>
      {/* One scroll (07/09). The stream cut stays a fixed region above the pane: it must show
          whatever is read. The question and gate go BACK into the thread as the last turn: taking
          them out was right while a question fit in ten lines, but a round questionnaire is two
          thousand pixels, which crushed the thread when fixed and made a second scrollbar when
          bounded. `follow` puts the view at the bottom on open, so on the question. */}
      <ChannelActionBand variant="head" notice={notice} />
      <ScrollArea
        size={size}
        follow
        label={label}
        count={segments.length}
        liveNoun={CHANNELS_TEXT.stream.noun}
        className={className}
      >
        <Stack gap={16}>
          <ChannelMessage who="human" name={briefAuthor} time={atTime(briefAt)}>
            <ChannelBrief text={brief} />
          </ChannelMessage>
          {/* `pending` only goes down as an id: the matching round shrinks to a pointer to the
              action block instead of asking the same question again. */}
          <ChannelStream
            segments={segments}
            sessions={sessions}
            archive={archive}
            agentName={agentName}
            operatorName={operatorName}
            promotedInboxId={pending?.inboxId}
          />
          <ChannelActionBand variant="thread" pending={pending?.node} decision={footer} />
        </Stack>
      </ScrollArea>
    </>
  );
}
