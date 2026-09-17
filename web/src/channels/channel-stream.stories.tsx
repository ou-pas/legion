// The first story feeds a real event stream through `transcript()`: the only way to check the
// split (speech / work / round / fact) holds on something other than a hand-written list. The
// second shows the empty state, which is not an outage: a session just started and said nothing.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelStream } from "./channel-stream.js";
import { FLUX } from "./fixtures.js";
import { transcript } from "./transcript.js";

const meta = { title: "channels / ChannelStream" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const FullConversation: Story = {
  name: "complete — speech, collapsed work, rounds, incident, open question",
  render: () => (
    <div className="dsc-conv">
      <ChannelStream segments={transcript(FLUX)} agentName="spec" operatorName="Operator" />
    </div>
  ),
};

export const PromotedQuestion: Story = {
  name: "question promoted — the open round refers to the band instead of repeating",
  render: () => (
    <div className="dsc-conv">
      <ChannelStream
        segments={transcript(FLUX)}
        agentName="spec"
        operatorName="Operator"
        promotedInboxId="i1"
      />
    </div>
  ),
};

export const Empty: Story = {
  name: "empty — nothing is waiting for you, the session hasn't said anything",
  render: () => (
    <div className="dsc-conv">
      <ChannelStream segments={[]} agentName="spec" operatorName="Operator" />
    </div>
  ),
};
