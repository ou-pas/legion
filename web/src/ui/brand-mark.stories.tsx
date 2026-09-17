import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrandMark } from "./brand-mark.js";
import { Row } from "./flex.js";
import { Logo } from "./shell.js";
import { Text } from "./text.js";

const meta = { title: "ui/BrandMark" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Alone: Story = {
  name: "alone, at the rail's size",
  render: () => (
    <span className="ui-logo-mark">
      <BrandMark />
    </span>
  ),
};

export const WithWordmark: Story = {
  name: "with the word — the full mark",
  render: () => <Logo>Legion</Logo>,
};

// The state that decides: at rail size the pillar must still read, or the mark is worthless in a
// top bar. Three copies side by side make the comparison possible by eye, which no gate can judge.
export const Repeated: Story = {
  name: "repeated — does the pillar hold at this size?",
  render: () => (
    <Row gap={4}>
      <span className="ui-logo-mark">
        <BrandMark />
      </span>
      <span className="ui-logo-mark">
        <BrandMark />
      </span>
      <span className="ui-logo-mark">
        <BrandMark />
      </span>
      <Text tone="muted" size="xs">
        at the size where it actually exists
      </Text>
    </Row>
  ),
};
