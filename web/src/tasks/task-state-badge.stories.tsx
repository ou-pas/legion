import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskStateBadge } from "./task-state-badge.js";
import type { DerivedTaskState } from "./derive-task-state.js";
import { Row } from "../ui/flex.js";

const meta = {
  component: TaskStateBadge,
  title: "ui / TaskStateBadge",
  tags: ["autodocs"],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const states: Array<{ state: DerivedTaskState; fact: string }> = [
  { state: "not-started", fact: "No execution" },
  { state: "running", fact: "Session in progress" },
  { state: "paused", fact: "Session waiting" },
  { state: "completed", fact: "Execution finished" },
  { state: "failed", fact: "Session failed" },
  { state: "contradiction", fact: "Inconsistent state" },
];

export const AllStates: Story = {
  args: { state: "not-started", fact: "No execution" },
  render: () => (
    <Row gap={12} wrap>
      {states.map(({ state, fact }) => (
        <TaskStateBadge key={state} state={state} fact={fact} title={`State: ${state}`} />
      ))}
    </Row>
  ),
};

export const NotStarted: Story = {
  args: { state: "not-started", fact: "No execution" },
};

export const Running: Story = {
  args: { state: "running", fact: "Session in progress" },
};

export const Paused: Story = {
  args: { state: "paused", fact: "Session waiting" },
};

export const Completed: Story = {
  args: { state: "completed", fact: "Execution finished" },
};

export const Failed: Story = {
  args: { state: "failed", fact: "Session failed" },
};

export const Contradiction: Story = {
  args: { state: "contradiction", fact: "Inconsistent state" },
};
