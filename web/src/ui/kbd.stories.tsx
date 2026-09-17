import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row } from "./flex.js";
import { Kbd } from "./kbd.js";
import { Text } from "./text.js";

const meta = { title: "ui / Kbd" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Sequence: Story = {
  name: "sequence",
  render: () => (
    <Row gap={10} wrap>
      <Kbd keys={["⌘", "K"]} />
    </Row>
  ),
};

export const SingleKey: Story = {
  name: "single key",
  render: () => (
    <Row gap={10} wrap>
      <Kbd keys="Esc" />
    </Row>
  ),
};

export const InASentence: Story = {
  name: "in a sentence",
  render: () => (
    <Row gap={10} wrap>
      <Text tone="muted">
        Open the palette with <Kbd keys={["⌘", "K"]} />, close it with <Kbd keys="Esc" />.
      </Text>
    </Row>
  ),
};
