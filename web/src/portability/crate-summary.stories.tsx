// The preview of an opened crate, before anything is created. The notes are not decorative: they
// say what the import will NOT do. A skill referenced by name without a folder is ignored on
// delivery, and a folder path describes the source machine. This is where to read it, before the
// click.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CrateSummaryView } from "./crate-summary.js";
import { Card } from "../ui/card.js";
import type { CrateSummary } from "../api/portability.js";

const meta = { title: "portability / CrateSummary" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const FULL: CrateSummary = {
  project: "Legion",
  counts: {
    environments: 2,
    agents: 7,
    repos: 3,
    rules: 19,
    mcpServers: 4,
    templates: 5,
    secrets: 6,
  },
  notes: [
    "6 secret(s) will be re-encrypted under this machine's master key.",
    "12 skill(s) are referenced by name. Their content doesn't travel: a name with no matching folder will be ignored.",
    "Folder access grants describe the origin machine. Reread them after the import.",
    "Nothing else is touched: not the existing projects, not the runners, not the global settings.",
  ],
};

const NO_SECRETS: CrateSummary = {
  project: "Lab",
  counts: {
    environments: 1,
    agents: 2,
    repos: 1,
    rules: 0,
    mcpServers: 0,
    templates: 0,
    secrets: 0,
  },
  notes: [
    "This crate contains no secrets: agents expecting one will start without it.",
    "Nothing else is touched: not the existing projects, not the runners, not the global settings.",
  ],
};

export const WithSecrets: Story = {
  name: "full crate, secrets included",
  render: () => (
    <Card title="Preview">
      <CrateSummaryView summary={FULL} />
    </Card>
  ),
};

export const WithoutSecrets: Story = {
  name: "no secrets — the screen says so",
  render: () => (
    <Card title="Preview">
      <CrateSummaryView summary={NO_SECRETS} />
    </Card>
  ),
};
