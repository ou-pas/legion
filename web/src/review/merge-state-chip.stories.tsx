// The THREE states `MergeState` knows, side by side so a glance (colour, word) tells a conflict
// from mere uncertainty. See merge-state.ts for why "unknown" stays `--wait` and never reads as
// "mergeable".
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MergeStateChip } from "./merge-state-chip.js";
import { Row } from "../ui/flex.js";

const meta = { title: "review / MergeStateChip" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mergeable: Story = {
  name: "mergeable — no known conflict",
  render: () => <MergeStateChip state="mergeable" />,
};

export const Conflict: Story = {
  name: "in conflict with main — blocks the merge",
  render: () => <MergeStateChip state="conflict" />,
};

export const Unknown: Story = {
  name: "not known yet — GitHub computes `mergeable` in the background (null)",
  render: () => <MergeStateChip state="unknown" />,
};

export const AllStates: Story = {
  name: "the three side by side",
  render: () => (
    <Row gap={8}>
      <MergeStateChip state="mergeable" />
      <MergeStateChip state="conflict" />
      <MergeStateChip state="unknown" />
    </Row>
  ),
};
