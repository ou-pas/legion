// Tones and sizes are literal unions. No mono prop: mono belongs to Code, CodeBlock, Kbd and Num.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row } from "./flex.js";
import { Caption, Label, Text } from "./text.js";

const meta = { title: "ui / Text · Caption · Label" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  name: "tones",
  render: () => (
    <Row gap={10} wrap>
      <Text>Session finished</Text>
      <Text tone="muted">7 files changed</Text>
      <Text tone="subtle">3 minutes ago</Text>
      <Text tone="wait">Waiting for your answer</Text>
      <Text tone="bad">Failed: Anthropic quota exceeded</Text>
      <Text tone="ok">Commit pushed to legion/stripe-webhooks</Text>
      {/* `accent` (07/09): the label that LOCATES ("you are here"), not a domain state. */}
      <Text tone="accent">Question 3 of 6</Text>
    </Row>
  ),
};

export const Sizes: Story = {
  name: "sizes",
  render: () => (
    <Row gap={10} wrap>
      <Text size="2xs">2xs</Text>
      <Text size="xs">xs — meta</Text>
      <Text size="sm">sm — list row</Text>
      <Text size="md">md — body</Text>
      <Text size="lg">lg — emphatic body</Text>
    </Row>
  ),
};

export const Weights: Story = {
  name: "weights",
  render: () => (
    <Row gap={10} wrap>
      <Text weight="normal">normal</Text>
      <Text weight="medium">medium</Text>
      <Text weight="semi">senior-dev</Text>
    </Row>
  ),
};

export const CaptionState: Story = {
  name: "Caption",
  render: () => (
    <Row gap={10} wrap>
      <Caption>Last session 12 min ago · 3 artifacts</Caption>
      <Caption tone="bad">No artifact produced</Caption>
    </Row>
  ),
};

export const LabelState: Story = {
  name: "Label",
  render: () => (
    <Row gap={10} wrap>
      <Label>Budget</Label>
      <Label tone="muted">Assigned repos</Label>
      <Label tone="wait">Approval gate</Label>
    </Row>
  ),
};
