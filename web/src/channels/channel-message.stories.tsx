// Both speakers side by side: the only way to check the initial column does not move from one
// message to the next, which is ALL that makes a conversation.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelMessage, ChannelSaid } from "./channel-message.js";
import { StatusChip } from "../ui/chip.js";
import { Stack } from "../ui/flex.js";
import { Markdownish } from "../ui/markdownish.js";

const meta = { title: "channels / ChannelMessage" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const BothSpeakers: Story = {
  name: "the two speakers — the agent and you",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={16}>
        <ChannelMessage who="agent" name="spec" time="12:31">
          <ChannelSaid>
            <Markdownish text="I'm loading the **grilling** skill and reading the code before asking anything." />
          </ChannelSaid>
        </ChannelMessage>
        <ChannelMessage who="human" name="Operator" time="12:34">
          <ChannelSaid>
            <Markdownish text="Don't touch `TaskPage.tsx` — this view is a second read." />
          </ChannelSaid>
        </ChannelMessage>
      </Stack>
    </div>
  ),
};

export const WithStatusPill: Story = {
  name: "with a pill — the agent is waiting for your reply",
  render: () => (
    <div className="dsc-conv">
      <ChannelMessage
        who="agent"
        name="spec"
        time="13:41"
        meta={<StatusChip state="wait">waiting for your answer</StatusChip>}
      >
        <ChannelSaid>
          <Markdownish text="Three decisions before writing the spec." />
        </ChannelSaid>
      </ChannelMessage>
    </div>
  ),
};

export const WithoutTime: Story = {
  name: "no time — an event with no timestamp",
  render: () => (
    <div className="dsc-conv">
      <ChannelMessage who="agent" name="senior-dev">
        <ChannelSaid>
          <Markdownish text="The stream carried no `ts`: no time is made up." />
        </ChannelSaid>
      </ChannelMessage>
    </div>
  ),
};

export const LongName: Story = {
  name: "long name — the initial doesn't move",
  render: () => (
    <div className="dsc-conv">
      <ChannelMessage who="agent" name="backend-relay-environments" time="09:02">
        <ChannelSaid>
          <Markdownish text="The initial column is fixed, whatever the name." />
        </ChannelSaid>
      </ChannelMessage>
    </div>
  ),
};
