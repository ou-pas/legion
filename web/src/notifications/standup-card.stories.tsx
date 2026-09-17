// Presentational, so every state comes from props: no daemon to simulate for a send failure or a
// long preview.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StandupCard } from "./standup-card.js";

const meta = { title: "notifications / StandupCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

const PREVIEW = `# Standup — 02/09
3 active goals, 2 open PRs, 1 gate waiting.
Cost for the last 24h: $4.80.`;

export const Disabled: Story = {
  name: "disabled — never scheduled",
  render: () => <StandupCard hour={null} onHourChange={noop} onSend={noop} />,
};

export const Scheduled: Story = {
  name: "scheduled — with preview",
  render: () => <StandupCard hour={8} preview={PREVIEW} onHourChange={noop} onSend={noop} />,
};

export const Sending: Story = {
  name: "sending",
  render: () => (
    <StandupCard hour={8} preview={PREVIEW} sending onHourChange={noop} onSend={noop} />
  ),
};

export const Sent: Story = {
  name: "sent — confirmation",
  render: () => <StandupCard hour={8} preview={PREVIEW} sent onHourChange={noop} onSend={noop} />,
};

export const HourRefused: Story = {
  name: "hour refused by the server",
  render: () => (
    <StandupCard
      hour={null}
      hourError="The hour must be between 0 and 23."
      onHourChange={noop}
      onSend={noop}
    />
  ),
};

export const SendFailed: Story = {
  name: "manual send failed",
  render: () => (
    <StandupCard
      hour={8}
      sendError="Discord didn't respond (504)."
      onHourChange={noop}
      onSend={noop}
    />
  ),
};
