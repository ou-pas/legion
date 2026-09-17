// Paths, hashes, commands, payloads, measures, and nothing else.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Code, CodeBlock } from "./code.js";
import { Row, Stack } from "./flex.js";
import { Text } from "./text.js";

const meta = { title: "ui / Code · CodeBlock" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const PAYLOAD = '{"repo":"front","changes":7,"commit":"5f0be31"}';

const RULE = `Any change to /src/checkout/ goes through a session with the spec agent before
implementation: the payment tunnel is never touched without a written spec.`;

export const InlineWash: Story = {
  name: "inline (wash)",
  render: () => (
    <Row gap={10} wrap>
      <Code>/repos/front/src/checkout/PaymentForm.tsx</Code>
      <Code>5f0be31</Code>
    </Row>
  ),
};

export const InlineBare: Story = {
  name: "inline (bare)",
  render: () => (
    <Row gap={10} wrap>
      <Text tone="muted">
        Commit <Code variant="bare">5f0be31</Code> on{" "}
        <Code variant="bare">legion/stripe-webhooks</Code>
      </Text>
    </Row>
  ),
};

export const BlockScroll: Story = {
  name: "block scroll",
  render: () => (
    <Stack gap={10}>
      <CodeBlock label="Commit event payload">{PAYLOAD}</CodeBlock>
    </Stack>
  ),
};

export const BlockWrap: Story = {
  name: "block wrap",
  render: () => (
    <Stack gap={10}>
      <CodeBlock variant="wrap">{`pnpm --filter @acme/front test -- --grep "checkout" --reporter=verbose --bail`}</CodeBlock>
    </Stack>
  ),
};

export const BlockPreviewCapped: Story = {
  name: "block preview (capped)",
  render: () => (
    <Stack gap={10}>
      <CodeBlock variant="preview">{`${RULE}\n\n${PAYLOAD}\n${PAYLOAD}\n${PAYLOAD}\n${PAYLOAD}`}</CodeBlock>
    </Stack>
  ),
};
