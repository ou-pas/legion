// The THREE states `PrState` knows, side by side to check at a glance that "open" and "merged" no
// longer blur (they shared a colour before this review). See pr-state-chip.tsx for the icon
// convention (one shape per state, like GitHub/Linear, not one recoloured shape).
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrStateChip } from "./pr-state-chip.js";
import { Row } from "../ui/flex.js";

const meta = { title: "review / PrStateChip" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  name: "open — green, git-pull-request icon",
  render: () => <PrStateChip state="open" />,
};

export const Merged: Story = {
  name: "merged — purple, git-merge icon",
  render: () => <PrStateChip state="merged" />,
};

export const Closed: Story = {
  name: "closed without merging — neutral, git-pull-request-closed icon",
  render: () => <PrStateChip state="closed" />,
};

export const AllStates: Story = {
  name: "the three side by side",
  render: () => (
    <Row gap={8}>
      <PrStateChip state="open" />
      <PrStateChip state="merged" />
      <PrStateChip state="closed" />
    </Row>
  ),
};
