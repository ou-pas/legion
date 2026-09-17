import type { Meta, StoryObj } from "@storybook/react-vite";
import { Filter } from "lucide-react";
import { CommandTrigger } from "./command-trigger.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / CommandTrigger" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const CMDK = ["⌘", "K"] as const;

export const Topbar: Story = {
  name: "topbar",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsn-topbar">
          <CommandTrigger
            label="Run a task, search…"
            keys={CMDK}
            onOpen={() => {}} /* la surface ouverte a sa propre story (ui / Modal) */
          />
        </div>
      </Stack>
    );
  },
};

export const WithoutShortcut: Story = {
  name: "without shortcut",
  render: () => (
    <Stack gap={10}>
      <div className="dsn-topbar">
        <CommandTrigger label="Filter sessions…" icon={<Filter />} onOpen={() => {}} />
      </div>
    </Stack>
  ),
};

export const TightSpaceTruncation: Story = {
  name: "tight space (truncation)",
  render: () => (
    <Stack gap={10}>
      <div className="dsn-topbar dsn-topbar--tight">
        <CommandTrigger label="Run a task, search…" keys={CMDK} onOpen={() => {}} />
      </div>
    </Stack>
  ),
};
