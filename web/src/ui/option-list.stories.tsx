// The vertical option list of a question with long choices.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { OptionList } from "./option-list.js";

const meta = { title: "ui / OptionList" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const OPTIONS = [
  {
    id: "php",
    label:
      "Provide a PHP environment in the session (or the CI pipeline) so I can scaffold pest/phpunit and write a real, verified test",
  },
  {
    id: "unverified",
    label:
      "Write the test and harness anyway without being able to run it, explicitly marking the status as unverified",
  },
  {
    id: "split",
    label:
      "Split the task differently (e.g. a separate task to scaffold the plugin's test tooling, before this one)",
  },
  {
    id: "drop",
    label: "Drop the task as is, the fix will wait for an environment able to run PHP",
  },
];

export const AtRest: Story = {
  name: "at rest — nothing clicked",
  render: function Render() {
    return <OptionList options={OPTIONS} onSelect={() => {}} />;
  },
};

export const Chosen: Story = {
  name: "chosen — between the click and the server's answer",
  render: function Render() {
    const [selectedId, setSelectedId] = useState<string | null>("unverified");
    return <OptionList options={OPTIONS} selectedId={selectedId} onSelect={setSelectedId} />;
  },
};

export const Disabled: Story = {
  name: "disabled — an answer is already in flight",
  render: function Render() {
    return <OptionList options={OPTIONS} selectedId="split" disabled onSelect={() => {}} />;
  },
};
