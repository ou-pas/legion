// The repo + branch pair seen in the trace, a PR header and a draft footer. Both data are
// optional, and both have a "not yet" state that is not an omission: a never-run task has NO
// branch (set on first run since slice nav/15), and a repo cited outside a session has no mount
// point. The chip must stay readable in all four combinations.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../ui/flex.js";
import { RepoChip } from "./repo-chip.js";

const meta = { title: "projects / RepoChip" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const RepoOnly: Story = {
  name: "the repo alone — cited outside a session",
  render: () => <RepoChip repo="legion" />,
};

export const WithBranch: Story = {
  name: "with its branch — the common case of a PR",
  render: () => <RepoChip repo="legion" branch="feature/environments-screen-3f9a1c2b" />,
};

export const NullBranch: Story = {
  name: "branch `null` — never launched, not an oversight",
  render: () => <RepoChip repo="legion" branch={null} />,
};

export const WithFolder: Story = {
  name: "with its mount point — what the agent sees in its container",
  render: () => <RepoChip repo="front" dir="./repos/front" />,
};

export const Complete: Story = {
  name: "all three — repo, folder, branch",
  render: () => (
    <RepoChip repo="front" dir="./repos/front" branch="feature/add-the-button-1a2b3c4d" />
  ),
};

export const SeveralRepos: Story = {
  name: "a cross-repo feature — two chips, the same branch",
  render: () => (
    <Stack gap={6}>
      <RepoChip repo="front" dir="./repos/front" branch="feature/add-the-button-1a2b3c4d" />
      <RepoChip repo="api" dir="./repos/api" branch="feature/add-the-button-1a2b3c4d" />
    </Stack>
  ),
};

export const LongNames: Story = {
  name: "long names — the chip doesn't break the row that holds it",
  render: () => (
    <RepoChip
      repo="acme-ai-prediction-api"
      dir="./repos/acme-ai-prediction-api"
      branch="feature/resolve-the-duplication-of-the-creation-popup-7d2e9f01"
    />
  ),
};
