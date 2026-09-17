// What goes into the crate. The state that matters is the third: secrets ticked. It is the only
// hatched row, the one moment the screen must say this box is unlike the others.
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CrateContents } from "./crate-contents.js";
import { DEFAULT_INCLUDE, type CrateInclude, type CratePart } from "../api/portability.js";
import { Card } from "../ui/card.js";

const meta = { title: "portability / CrateContents" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const COUNTS: Record<CratePart, number> = {
  agents: 7,
  repos: 3,
  mcpServers: 4,
  rules: 19,
  templates: 5,
  secrets: 6,
};
const EMPTY: Record<CratePart, number> = {
  agents: 0,
  repos: 0,
  mcpServers: 0,
  rules: 0,
  templates: 0,
  secrets: 0,
};

function Live({ counts, start }: { counts: Record<CratePart, number>; start: CrateInclude }) {
  const [include, setInclude] = useState(start);
  return (
    <Card title="What goes into the crate">
      <CrateContents counts={counts} include={include} onChange={setInclude} />
    </Card>
  );
}

export const Default: Story = {
  name: "by default — secrets unchecked",
  render: function Render() {
    return <Live counts={COUNTS} start={DEFAULT_INCLUDE} />;
  },
};

export const WithSecrets: Story = {
  name: "secrets checked — the hatched row",
  render: function Render() {
    return <Live counts={COUNTS} start={{ ...DEFAULT_INCLUDE, secrets: true }} />;
  },
};

export const NothingChecked: Story = {
  name: "nothing checked — the crate would be empty",
  render: function Render() {
    return (
      <Live
        counts={COUNTS}
        start={{
          agents: false,
          repos: false,
          mcpServers: false,
          rules: false,
          templates: false,
          secrets: false,
        }}
      />
    );
  },
};

export const EmptyProject: Story = {
  name: "new project — everything at zero",
  render: function Render() {
    return <Live counts={EMPTY} start={DEFAULT_INCLUDE} />;
  },
};
