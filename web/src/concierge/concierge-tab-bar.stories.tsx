// The phone tab bar on the concierge. A single row: see concierge-tab-bar.tsx.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConciergeTabBar } from "./concierge-tab-bar.js";

const meta = { title: "concierge / Tab bar" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SingleExit: Story = {
  name: "a single target — back to work",
  render: () => <ConciergeTabBar />,
};
