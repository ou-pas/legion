// The only state of this screen: the id designates nothing. What matters is that it says WHY
// (archived, or stale id) and offers a way out instead of an empty page.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskAbsent } from "./task-absent.js";

const meta = { title: "tasks / TaskAbsent" } satisfies Meta;
export default meta;
type Story = StoryObj;

export const NotFound: Story = {
  name: "the identifier points to nothing",
  render: () => <TaskAbsent />,
};
