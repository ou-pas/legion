// The draggable board card and its ghost while dragging. Two components for one object, on
// purpose: the board card carries the handle, the ghost does not (it is what shows under the
// cursor, outside any column). One stories file is the only way to check they still look alike.
//
// The card needs a dnd-kit context to mount; the workshop gives it an empty one. Not decoration:
// `useSortable` outside a context renders nothing, and the story would be a blank canvas.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { TASK_STATUS } from "../api/tasks.js";
import { Button } from "../ui/button.js";
import { Stack } from "../ui/flex.js";
import { DraggedTaskCard, SortableTaskCard } from "./sortable-task-card.js";
import { demoSession, demoTaskSummary } from "./task-fixture.js";

const meta = { title: "tasks / SortableTaskCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** An empty dnd-kit context: the card mounts, nothing drags. */
const board = (children: ReactNode, ids: string[]) => (
  <DndContext>
    <SortableContext items={ids}>
      <Stack gap={8}>{children}</Stack>
    </SortableContext>
  </DndContext>
);

export const Todo: Story = {
  name: "todo — the common case for a board column",
  render: () =>
    board(
      <SortableTaskCard
        task={demoTaskSummary({ status: TASK_STATUS.todo, branch: null })}
        agentName="builder"
      />,
      ["t-1"],
    ),
};

export const Doing: Story = {
  name: "in progress — its live session is on the card",
  render: () =>
    board(
      <SortableTaskCard
        task={demoTaskSummary({ status: TASK_STATUS.doing })}
        session={demoSession({ status: "running" })}
        agentName="builder"
      />,
      ["t-1"],
    ),
};

export const WithGateAndReadOnly: Story = {
  name: "under gate and read-only — both marks fit on the card",
  render: () =>
    board(
      <SortableTaskCard
        task={demoTaskSummary({ status: TASK_STATUS.review, approvalGate: true, readOnly: true })}
        agentName="reviewer"
      />,
      ["t-1"],
    ),
};

export const Blocked: Story = {
  name: "blocked by two others — the card COUNTS, the page names",
  render: () =>
    board(
      <SortableTaskCard
        task={demoTaskSummary({
          status: TASK_STATUS.todo,
          branch: null,
          blockedBy: [
            { id: "t-2", name: "Write the routes", status: TASK_STATUS.doing },
            { id: "t-3", name: "Lay down the schema", status: TASK_STATUS.review },
          ],
        })}
        agentName="builder"
      />,
      ["t-1"],
    ),
};

export const WithActions: Story = {
  name: "with its actions — what the column puts on each card",
  render: () =>
    board(
      <SortableTaskCard
        task={demoTaskSummary({ status: TASK_STATUS.review })}
        agentName="reviewer"
        actions={<Button size="sm">Approve</Button>}
      />,
      ["t-1"],
    ),
};

export const WithoutAgent: Story = {
  name: "no agent assigned — the card doesn't invent a name",
  render: () =>
    board(
      <SortableTaskCard
        task={demoTaskSummary({ status: TASK_STATUS.later, assigneeAgentId: null, branch: null })}
      />,
      ["t-1"],
    ),
};

export const LongName: Story = {
  name: "a long name in a narrow column — it wraps, it doesn't overflow",
  render: () =>
    board(
      <SortableTaskCard
        task={demoTaskSummary({
          name: "Resolve the duplication in the quick create popup between the Issues screen and the Reviews screen",
        })}
        session={demoSession()}
        agentName="builder"
      />,
      ["t-1"],
    ),
};

export const Ghost: Story = {
  name: "the drag ghost — the same card, no handle, under the cursor",
  render: () => (
    <DraggedTaskCard
      task={demoTaskSummary({ status: TASK_STATUS.doing })}
      session={demoSession({ status: "running" })}
      agentName="builder"
    />
  ),
};
