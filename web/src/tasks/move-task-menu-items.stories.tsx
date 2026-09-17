// The "Move to ..." rows as they appear in a menu, the dedicated trigger (`MoveTaskControl`) or
// the "..." menu collapsed under 640px.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Menu } from "../ui/menu.js";
import { moveOptions } from "./task-moves.js";
import { TASK_STATUS } from "../api/tasks.js";
import { MoveTaskMenuItems } from "./move-task-menu-items.js";
import { TASK_PAGE_TEXT } from "./text/task-page.js";

const meta = { title: "tasks / MoveTaskMenuItems" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const FromTodo: Story = {
  name: "from todo, in an open menu — later, review, or done",
  render: () => (
    <Menu label={TASK_PAGE_TEXT.move.field}>
      <MoveTaskMenuItems
        taskId="t-1"
        destinations={moveOptions(TASK_STATUS.todo)}
        onMoved={() => {}}
        onError={() => {}}
      />
    </Menu>
  ),
};
