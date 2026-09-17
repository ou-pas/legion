// The only primitives allowed to emit flex. Spacer pushes what follows to the right.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row, Spacer, Stack } from "./flex.js";

const meta = { title: "ui / Row / Stack / Spacer" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const RowGap8: Story = {
  name: "Row · gap 8",
  render: () => (
    <Stack gap={10}>
      <Row gap={8} className="dsl-frame">
        <span className="dsl-box">senior-dev</span>
        <span className="dsl-box">spec</span>
        <span className="dsl-box">reviewer</span>
      </Row>
    </Stack>
  ),
};

export const RowSpacer: Story = {
  name: "Row + Spacer",
  render: () => (
    <Stack gap={10}>
      <Row gap={8} className="dsl-frame">
        <span className="dsl-box">Payment tunnel redesign</span>
        <Spacer />
        <span className="dsl-num">$2.87</span>
      </Row>
    </Stack>
  ),
};

export const RowWrap: Story = {
  name: "Row · wrap",
  render: () => (
    <Stack gap={10}>
      <Row gap={8} wrap className="dsl-frame dsl-narrow">
        <span className="dsl-box">legion/checkout</span>
        <span className="dsl-box">home-server</span>
        <span className="dsl-box">docker</span>
        <span className="dsl-box">playwright</span>
      </Row>
    </Stack>
  ),
};

export const StackGap10: Story = {
  name: "Stack · gap 10",
  render: () => (
    <Stack gap={10}>
      <Stack gap={10} className="dsl-frame">
        <span className="dsl-box">Stripe Checkout payment tunnel redesign</span>
        <span className="dsl-box">PDF export of monthly reports</span>
      </Stack>
    </Stack>
  ),
};
