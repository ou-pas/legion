// The interview tab of the task page (D9ter), labelled "Channel".
//
// The same thread as the channel view, and that is the non-optional condition of the decision: one
// source, two renderings. The thread component (`channels/channel-thread.tsx`) and the segments
// (`transcript()` on the same session stream) are shared. Reimplementing here would let the two
// surfaces diverge, a round visible there and not here.
//
// This tab does not render the open round's form: the task page already has its question registry
// above the tabs, and a second one would make two forms for one question, 200 px apart. The open
// round shows as waiting, with a line saying where to answer.
import type { ReactNode } from "react";
import { ChannelThread } from "../channels/channel-thread.js";
import type { Segment } from "../channels/transcript.js";
import { Row, Spacer, Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { countRounds } from "./interview.js";
import { INTERVIEW_TEXT } from "./text.js";

export function InterviewTab({
  brief,
  briefAuthor,
  briefAt,
  segments,
  agentName,
  channelLink,
}: {
  brief: string;
  briefAuthor: string;
  briefAt?: number;
  segments: Segment[];
  agentName: string;
  /** The link to the same task's channel, the other rendering of the same thread (Q-E). */
  channelLink?: ReactNode;
}) {
  const rounds = countRounds(segments);

  return (
    <Stack gap={10}>
      {/* The counter, visible and with no ceiling: the server imposes none, the screen does not
          invent one. Rendered only here since 15/09 (D4); `InterviewExit` no longer repeats it. */}
      <Row gap={6} wrap>
        <Text size="sm" weight="semi">
          {rounds === 0 ? INTERVIEW_TEXT.tab.noRound : INTERVIEW_TEXT.tab.rounds(rounds)}
        </Text>
        <Spacer />
        {channelLink}
      </Row>

      <ChannelThread
        size="lg"
        label={INTERVIEW_TEXT.tab.threadLabel}
        brief={brief}
        briefAuthor={briefAuthor}
        briefAt={briefAt}
        segments={segments}
        agentName={agentName}
        operatorName={briefAuthor}
      />
    </Stack>
  );
}
