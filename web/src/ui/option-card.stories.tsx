// An exclusive choice as cards: label, reason, dot.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { StatusChip } from "./chip.js";
import { Heading } from "./heading.js";
import { OptionCards, type OptionCardItem } from "./option-card.js";

const meta = { title: "ui / OptionCards" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const badge = (
  <StatusChip state="ok" dot={false} size="sm">
    recommended
  </StatusChip>
);

const OPTIONS: OptionCardItem[] = [
  {
    id: "a",
    label: "A — values only",
    why: "What the ticket asks for word for word, but two grammars depending on the value type.",
  },
  {
    id: "b",
    label: "B — human label + values",
    badge,
    why: 'Keeps the "name: value" shape of the other cards; the label "Tag names" is already in the catalog.',
  },
  { id: "c", label: "C — raw key + values" },
];

export const Chosen: Story = {
  name: "one option chosen — the recommended one, with its badge and its reason",
  render: function Render() {
    const [value, setValue] = useState<string | null>("b");
    return (
      <div className="dsd-half">
        <Heading level={3} id="q-title">
          What should the line under the tool name look like?
        </Heading>
        <OptionCards options={OPTIONS} value={value} onChange={setValue} labelledBy="q-title" />
      </div>
    );
  },
};

export const Blank: Story = {
  name: "no option chosen — nothing is painted as selected",
  render: function Render() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <div className="dsd-half">
        <OptionCards options={OPTIONS} value={value} onChange={setValue} label="Subtitle shape" />
      </div>
    );
  },
};

export const Inline: Story = {
  name: "layout row — two short options side by side",
  render: function Render() {
    const [value, setValue] = useState<string | null>("same");
    return (
      <OptionCards
        layout="row"
        label="Object settings"
        value={value}
        onChange={setValue}
        options={[
          { id: "same", label: "Same rule: also show their content", badge },
          { id: "lists", label: "Lists only for this task" },
        ]}
      />
    );
  },
};

export const Disabled: Story = {
  name: "disabled — an answer is in flight",
  render: function Render() {
    return (
      <div className="dsd-half">
        <OptionCards options={OPTIONS} value="b" onChange={() => {}} disabled label="Forme" />
      </div>
    );
  },
};
