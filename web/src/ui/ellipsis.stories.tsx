// Measured by ONE ResizeObserver shared by the whole app (use-truncated.ts): the Tooltip opens
// ONLY if the text really overflows its box. The short text below sets no title; hover it and
// nothing opens.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ellipsis } from "./ellipsis.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / Ellipsis" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const LONG_TASK = "Hosted Stripe Checkout payment tunnel redesign with webhook migration";

export const OneLineTruncatedHover: Story = {
  name: "one line, truncated (hover)",
  render: () => (
    <Stack gap={10}>
      <div className="ds-tp-narrow">
        <Ellipsis>{LONG_TASK}</Ellipsis>
      </div>
    </Stack>
  ),
};

export const TwoLinesTruncatedHover: Story = {
  name: "lines=2, truncated (hover)",
  render: () => (
    <Stack gap={10}>
      <div className="ds-tp-narrow">
        <Ellipsis lines={2}>{LONG_TASK}</Ellipsis>
      </div>
    </Stack>
  ),
};

export const ShortTextNoTooltip: Story = {
  name: "short text (not truncated → no tooltip)",
  render: () => (
    <Stack gap={10}>
      <div className="ds-tp-narrow">
        <Ellipsis>Replay the webhooks</Ellipsis>
      </div>
    </Stack>
  ),
};

export const SideRightDenseList: Story = {
  name: "side=right (dense list)",
  render: () => (
    <Stack gap={10}>
      <div className="ds-tp-narrow">
        <Ellipsis side="right">{LONG_TASK}</Ellipsis>
      </div>
    </Stack>
  ),
};
