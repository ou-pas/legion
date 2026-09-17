// Only exists next to a PR with a `--bad` chip (see merge-state-chip.stories.tsx). The default
// state shows the gesture AND its explanation together, before any click: never a `title` a click
// would reveal.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResolveConflictButton } from "./resolve-conflict-button.js";

const meta = { title: "review / ResolveConflictButton" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  name: "ready — the action and its explanation, before any click",
  render: () => <ResolveConflictButton taskId="t-1" repo="legion" number={62} />,
};
