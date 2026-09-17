// What changes between states is not the name but the two marks before it (approval gate,
// read-only) and the chain link, only present when the task is a step of one. The "just its name"
// story comes first: the common case, where the header must fit on one line.
//
// The external reference (Linear...) and the container link moved to the panel on 10/09: their
// stories live in `task-inspector.stories.tsx`.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Task } from "../api/tasks.js";
import { COMPLEXITY, PRIORITY, TASK_STATUS } from "../api/tasks.js";
import { TaskHeader } from "./task-header.js";

const meta = { title: "tasks / TaskHeader" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AT = "2026-09-04T09:00:00.000Z";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.doing,
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
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "",
  externalRef: null,
  expectedArtifacts: "",
  scheduledAt: null,
  branch: "feature/environments-screen",
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

export const NameOnly: Story = {
  name: "nothing but its name — the common case, one line",
  render: () => <TaskHeader task={task()} />,
};

export const WithGate: Story = {
  name: "approval gate — the stamp in front of the name",
  render: () => <TaskHeader task={task({ approvalGate: true })} />,
};

export const ReadOnly: Story = {
  name: "read-only — the crossed-out pen: nothing will be pushed",
  render: () => <TaskHeader task={task({ readOnly: true })} />,
};

export const GateAndReadOnly: Story = {
  name: "both marks, in the order they read",
  render: () => <TaskHeader task={task({ approvalGate: true, readOnly: true })} />,
};

export const ChainStep: Story = {
  name: "a chain step — the link to its flow",
  render: () => <TaskHeader task={task({ templateRunId: "run-7" })} />,
};

export const VeryLongName: Story = {
  name: "a name that wraps — the link stays underneath",
  render: () => (
    <TaskHeader
      task={task({
        name: "Resolve the duplication in the quick create popup between the Issues screen and the Reviews screen, then add the safety net",
        templateRunId: "run-7",
      })}
    />
  ),
};
