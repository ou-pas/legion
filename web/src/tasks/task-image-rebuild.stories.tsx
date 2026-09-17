// The gesture recovering a missing image, next to the verdict. The second state avoids the second
// click: while building, the button DISAPPEARS and the waiting sentence takes its place. A
// disabled button explains nothing (its `title` does not show) and a second click would only be
// refused.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskImageRebuild } from "./task-image-rebuild.js";

const meta = { title: "tasks / TaskImageRebuild" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Missing: Story = {
  name: "image missing — the cause and the action in the same sentence",
  render: () => (
    <TaskImageRebuild
      taskId="t-1"
      wait={{ image: "legion-session:latest", runnerName: "mini-workshop", rebuilding: false }}
    />
  ),
};

export const Rebuilding: Story = {
  name: "rebuilding — the button gives way to the wait",
  render: () => (
    <TaskImageRebuild
      taskId="t-1"
      wait={{ image: "legion-session:latest", runnerName: "mini-workshop", rebuilding: true }}
    />
  ),
};

/** The ordinary case: nothing waits for an image, the component renders nothing. */
export const NothingWaiting: Story = {
  name: "no waiting — nothing shown",
  tags: ["renders-nothing"],
  render: () => <TaskImageRebuild taskId="t-1" wait={null} />,
};
