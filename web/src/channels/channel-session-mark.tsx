// The break between two sessions of one task (26/08). Since the thread spans the whole task, a resume
// after failure lands mid-conversation. Unmarked, it would read as the same session: the agent starts
// over, re-asks a question, and seems to go in circles when it was just reborn in a fresh container.
//
// A rule and a label, not a card: the break is a seam, not a conversation event. It must fade when
// reading and show when scanning.
import type { TaskEventSession } from "../api/task-history.js";
import { Caption } from "../ui/text.js";
import { atTime } from "./clock.js";
import { CHANNELS_TEXT } from "./text.js";
import "./channel-session-mark.css";

export function ChannelSessionMark({
  index,
  session,
  agentName,
}: {
  index: number;
  /** Absent when history has not loaded (yet): the seam is still marked, without caption. Hiding it
   *  would be worse than a half caption. */
  session?: TaskEventSession;
  agentName?: string;
}) {
  const t = CHANNELS_TEXT.sessionMark;
  const ended = session?.endReason ? t.endReason(session.endReason) : null;
  return (
    <div className="ch-session-mark" role="separator">
      <span className="ch-session-rule" aria-hidden="true" />
      <Caption tone="subtle" className="ch-session-label">
        {t.nth(index)}
        {agentName ? ` · ${agentName}` : ""}
        {session?.model ? ` · ${session.model}` : ""}
        {session?.startedAt ? ` · ${atTime(session.startedAt)}` : ""}
        {ended ? ` · ${ended}` : ""}
      </Caption>
      <span className="ch-session-rule" aria-hidden="true" />
    </div>
  );
}
