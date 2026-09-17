// The second rendering of the thread (D9ter). Compare story by story with "channels /
// ChannelThread": the SAME thread component on the same segments. What the tab adds sits above
// (the round counter, no ceiling), never inside the thread.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card, CardBody } from "../ui/card.js";
import { Link } from "../ui/link.js";
import { BRIEF, BRIEF_AT, FLUX } from "../channels/fixtures.js";
import { transcript } from "../channels/transcript.js";
import { InterviewTab } from "./interview-tab.js";
import { INTERVIEW_TEXT } from "./text.js";

const meta = { title: "interviews / InterviewTab" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const link = <Link href="#canal">{INTERVIEW_TEXT.compare.link}</Link>;

export const TwoRounds: Story = {
  name: "two rounds — one answered and collapsed, one open and waiting",
  render: () => (
    <div className="dsc-conv">
      <Card pad={false}>
        <CardBody>
          <InterviewTab
            brief={BRIEF}
            briefAuthor="Operator"
            briefAt={BRIEF_AT}
            segments={transcript(FLUX)}
            agentName="interviewer"
            channelLink={link}
          />
        </CardBody>
      </Card>
    </div>
  ),
};

export const NoRound: Story = {
  name: "no round yet — the interview just started, it's not a failure",
  render: () => (
    <div className="dsc-conv">
      <Card pad={false}>
        <CardBody>
          <InterviewTab
            brief={BRIEF}
            briefAuthor="Operator"
            briefAt={BRIEF_AT}
            segments={[]}
            agentName="interviewer"
            channelLink={link}
          />
        </CardBody>
      </Card>
    </div>
  ),
};

export const WithoutChannelLink: Story = {
  name: "no channel link — the link is a slot, the tab doesn't know the router",
  render: () => (
    <div className="dsc-conv">
      <Card pad={false}>
        <CardBody>
          <InterviewTab
            brief={BRIEF}
            briefAuthor="Operator"
            briefAt={BRIEF_AT}
            segments={transcript(FLUX)}
            agentName="interviewer"
          />
        </CardBody>
      </Card>
    </div>
  ),
};
