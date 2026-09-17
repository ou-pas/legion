// A 1 px rule. With a label the line runs behind the text: continuous, not cut in two.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Divider } from "./divider.js";
import { Row, Stack } from "./flex.js";
import { Inset } from "./inset.js";

const meta = { title: "ui / Divider" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  name: "horizontal",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-sheet">
        <div>Step 2 — Stripe Checkout payment tunnel redesign</div>
        <Divider space="sm" />
        <div>Step 3 — PDF export of monthly reports</div>
      </div>
    </Stack>
  ),
};

export const WithLabel: Story = {
  name: "with label",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-sheet">
        <div>Commit 9c1f0ab on legion/checkout</div>
        <Divider label="After approval" space="md" />
        <div>Staging deployment</div>
      </div>
    </Stack>
  ),
};

export const LabelInNormalCase: Story = {
  name: "label in sentence case",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-sheet">
        <div>Connect GitHub</div>
        <Divider label="or via Personal Access Token" labelCase="sentence" space="md" />
        <div>ghp_…</div>
      </div>
    </Stack>
  ),
};

export const OnSunkenSurface: Story = {
  name: "on a recessed surface",
  render: () => {
    return (
      <Stack gap={10}>
        <Inset>
          <div>Goal budget: $5.00</div>
          <Divider label="Spent" surface="recess" space="sm" />
          <div>$2.87 — 57%</div>
        </Inset>
      </Stack>
    );
  },
};

export const Vertical: Story = {
  name: "vertical",
  render: () => (
    <Row gap={10} wrap>
      <Row gap={0} align="center" className="dsl-frame">
        <span className="dsl-box">senior-dev</span>
        <Divider orientation="vertical" space="md" />
        <span className="dsl-box">legion/checkout</span>
        <Divider orientation="vertical" space="md" />
        <span className="dsl-num">$2.87</span>
      </Row>
    </Row>
  ),
};
