// Each swatch's name is visually hidden: what is checked is that one sees WHICH hue is derived
// and WHICH is chosen without reading a word. The first carries a dot, the second a frame.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Card } from "../ui/card.js";
import { Stack } from "../ui/flex.js";
import { Text } from "../ui/text.js";
import { HuePicker } from "./hue-picker.js";

const meta = { title: "projects / Project color (HuePicker)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The hue the rule gives a project named "Kopee", the one with the dot. */
const DERIVED = 4;

export const Automatic: Story = {
  name: "automatic — no choice, the derived one holds",
  render: () => (
    <Card title="Project color">
      <HuePicker value={null} derived={DERIVED} onChange={() => {}} />
    </Card>
  ),
};

export const Chosen: Story = {
  name: "chosen — a hue replaces the derived one",
  render: () => (
    <Card title="Project color">
      <HuePicker value={7} derived={DERIVED} onChange={() => {}} />
    </Card>
  ),
};

export const ChosenOverDerived: Story = {
  name: "chosen on the derived one — the dot and the frame overlap",
  render: () => (
    <Card title="Project color">
      <HuePicker value={DERIVED} derived={DERIVED} onChange={() => {}} />
    </Card>
  ),
};

export const Live: Story = {
  name: "live — click, then go back to automatic",
  // A stateful story is written `function Render()`: an anonymous arrow is not a component for
  // `react-hooks`, and the hook below would break the rule.
  render: function Render() {
    const [value, setValue] = useState<number | null>(null);
    return (
      <Card title="Project color">
        <Stack gap={10}>
          <HuePicker value={value} derived={DERIVED} onChange={setValue} />
          <Text tone="muted" size="sm">
            {value === null ? "no choice — the derived one holds" : `hue chosen: ${value}`}
          </Text>
        </Stack>
      </Card>
    );
  },
};
