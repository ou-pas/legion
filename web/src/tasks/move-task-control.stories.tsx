// An icon opening the destinations menu: a menu click is deliberate, a select's `onChange` is not.
// The destinations offered depend on the starting status (`task-moves.ts`).
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Task } from "../api/tasks.js";
import { MoveTaskControl } from "./move-task-control.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

const meta = { title: "tasks / MoveTaskControl" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AT = "2026-08-28T09:00:00.000Z";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.todo,
  settledOutcome: null,
  assigneeAgentId: "a-1",
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
  templateId: null,
  templateRunId: null,
  stepIndex: null,
  blockedBy: [],
  criteria: null,
  branch: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "",
  externalRef: null,
  expectedArtifacts: "",
  scheduledAt: null,
  createdAt: AT,
  updatedAt: AT,
  boardOrder: 1,
  editable: false,
  briefEditable: false,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
  ...over,
});

export const FromTodo: Story = {
  name: "from todo — later, review, or done",
  render: () => (
    <MoveTaskControl
      task={task({ status: TASK_STATUS.todo })}
      onMoved={() => {}}
      onError={() => {}}
    />
  ),
};

export const FromLater: Story = {
  name: 'from "later" — only todo is allowed',
  render: () => (
    <MoveTaskControl
      task={task({ status: TASK_STATUS.later })}
      onMoved={() => {}}
      onError={() => {}}
    />
  ),
};

export const FromReview: Story = {
  name: 'from review — todo or done, never "later"',
  render: () => (
    <MoveTaskControl
      task={task({ status: TASK_STATUS.review })}
      onMoved={() => {}}
      onError={() => {}}
    />
  ),
};
