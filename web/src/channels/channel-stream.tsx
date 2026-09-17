// The conversation: transcript segments in time order. This module DECIDES nothing (segmenting is
// `transcript.ts`, sentences are in the catalog, answering stays the inbox's gesture): it assembles.
import { Empty } from "../ui/empty.js";
import { Stack } from "../ui/flex.js";
import { Markdownish } from "../ui/markdownish.js";
import { ChannelMessage, ChannelSaid } from "./channel-message.js";
import { ChannelNotice } from "./channel-notice.js";
import { ChannelRound } from "./channel-round.js";
import { ChannelSessionMark } from "./channel-session-mark.js";
import { ChannelWork } from "./channel-work.js";
import { atTime } from "./clock.js";
import { CHANNELS_TEXT } from "./text.js";
import type { InboxHistoryEntry } from "../api/inbox.js";
import type { TaskEventSession } from "../api/task-history.js";
import type { Segment } from "./transcript.js";

export function ChannelStream({
  segments,
  agentName,
  operatorName,
  promotedInboxId,
  sessions = [],
  archive = [],
}: {
  segments: Segment[];
  agentName: string;
  operatorName: string;
  /** The task's sessions, to CAPTION the breaks. Empty = the seam is marked unnamed: hiding a resume
   *  would be worse than half-naming it. */
  sessions?: TaskEventSession[];
  /** The task's inbox archive: what surrounded each past question. Empty = rounds read without their
   *  choices, a clean degradation, never an empty screen. */
  archive?: InboxHistoryEntry[];
  /** Inbox id of the question RAISED into the action band. Its round shrinks to a pointer: one
   *  question, one place to answer. Absent = open rounds render in place, as the band-less surface
   *  needs. */
  promotedInboxId?: string;
}) {
  if (segments.length === 0) {
    return <Empty variant="panel" title={CHANNELS_TEXT.stream.empty.title} />;
  }
  return (
    <Stack gap={16}>
      {segments.map((seg) => {
        if (seg.kind === "say") {
          return (
            <ChannelMessage
              key={seg.key}
              who={seg.who}
              time={atTime(seg.at)}
              name={seg.who === "agent" ? agentName : operatorName}
            >
              <ChannelSaid>
                <Markdownish text={seg.text} />
              </ChannelSaid>
            </ChannelMessage>
          );
        }
        if (seg.kind === "work") return <ChannelWork key={seg.key} band={seg.band} />;
        if (seg.kind === "session") {
          return (
            <ChannelSessionMark
              key={seg.key}
              index={seg.index}
              session={sessions.find((s) => s.id === seg.sessionId)}
              agentName={agentName}
            />
          );
        }
        if (seg.kind === "notice")
          return (
            <ChannelNotice key={seg.key} tone={seg.tone} code={seg.code} detail={seg.detail} />
          );
        return (
          <ChannelMessage key={seg.key} who="agent" name={agentName} time={atTime(seg.at)}>
            <ChannelRound
              question={seg.question}
              answer={seg.answer}
              answeredTime={atTime(seg.answeredAt)}
              archive={archive.find((a) => a.id === seg.inboxId)}
              promoted={promotedInboxId === seg.inboxId}
            />
          </ChannelMessage>
        );
      })}
    </Stack>
  );
}
