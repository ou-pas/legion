// The EMPTY state matters most: a task run without a brief is a real case (the agent only got
// the title), and the screen must say so instead of showing an empty frame.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelBrief } from "./channel-brief.js";

const meta = { title: "channels / ChannelBrief" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const SHORT = `Legion is missing a way to **discuss** a feature before launching it.

Run a grilling session. Your deliverable is a \`spec.md\`.`;

const LONG = `${SHORT}

## What exists
- \`inbox_ask\` asks a question and pauses the session.
- The form (v31) allows N questions in one pause.

## What's missing
- Nothing lets rounds chain without going back through the board.
- The operator's answers are visible nowhere.

## Don't
- Don't touch the runner.
- Don't create any server route.

## Verify
\`pnpm lint\` then \`pnpm --filter @legion/web build\`.`;

export const ShortBrief: Story = {
  name: "short — everything reads at a glance",
  render: () => (
    <div className="dsc-conv">
      <ChannelBrief text={SHORT} />
    </div>
  ),
};

export const LongBrief: Story = {
  name: "long — an excerpt, and the rest on a gesture",
  render: () => (
    <div className="dsc-conv">
      <ChannelBrief text={LONG} />
    </div>
  ),
};

export const EmptyBrief: Story = {
  name: "empty — the task shipped with no brief",
  render: () => (
    <div className="dsc-conv">
      <ChannelBrief text="" />
    </div>
  ),
};
