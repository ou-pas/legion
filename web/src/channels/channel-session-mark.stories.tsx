// The break between two sessions. The state that matters is the middle one: a resume AFTER A
// FAILURE. Without the mark, an agent starting over, rediscovering the repository and asking an
// already asked question reads as an agent going in circles.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TaskEventSession } from "../api/task-history.js";
import { Stack } from "../ui/flex.js";
import { ChannelMessage, ChannelSaid } from "./channel-message.js";
import { ChannelSessionMark } from "./channel-session-mark.js";

const meta = { title: "channels / ChannelSessionMark" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const T = new Date("2026-08-26T14:12:00Z").getTime();

const SESSION: TaskEventSession = {
  id: "s-2",
  status: "destroyed",
  agentId: "a-1",
  model: "claude-sonnet-4-8",
  startedAt: T,
  endedAt: T + 22 * 60_000,
  endReason: null,
};

export const Captioned: Story = {
  name: "captioned — agent, model, time",
  render: () => <ChannelSessionMark index={2} session={SESSION} agentName="senior-dev" />,
};

export const AfterFailure: Story = {
  name: "after a failure — the end cause comes from the server, never rephrased",
  render: () => (
    <ChannelSessionMark
      index={3}
      agentName="senior-dev"
      session={{ ...SESSION, id: "s-3", status: "failed", endReason: "killed for lack of memory" }}
    />
  ),
};

export const WithoutCaption: Story = {
  name: "no caption — history hasn't loaded yet",
  render: () => <ChannelSessionMark index={2} />,
};

export const InTheThread: Story = {
  name: "in the thread — what it really separates",
  render: () => (
    <Stack gap={16}>
      <ChannelMessage who="agent" name="senior-dev" time="13:58">
        <ChannelSaid>
          The lint fails on a rule I&apos;m not allowed to change. I&apos;m stopping here.
        </ChannelSaid>
      </ChannelMessage>
      <ChannelSessionMark index={2} session={SESSION} agentName="senior-dev" />
      <ChannelMessage who="agent" name="senior-dev" time="14:12">
        <ChannelSaid>
          I&apos;m resuming the task. I&apos;ll start by rereading the previous session&apos;s diff.
        </ChannelSaid>
      </ChannelMessage>
    </Stack>
  ),
};
