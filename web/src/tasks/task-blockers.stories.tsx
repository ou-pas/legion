// What holds a task back, named. The case that matters is the SECOND: a Wiki step blocked by two
// slices of a batch, what the single column could not say and why the table exists. The other
// two show that older dependencies (a chain step, a blocking repo) read in the same place.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TaskBlocker } from "../api/tasks.js";
import { TaskBlockersPanel } from "./task-blockers.js";
import { TASK_STATUS } from "../api/tasks.js";

const meta = { title: "tasks / TaskBlockersPanel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Labels come from the real board: long names are what must be seen to fit. */
const previousStep: TaskBlocker = {
  id: "s2",
  name: "Step 2/5 — Make the webhook idempotent · Harden the payment webhook",
  status: TASK_STATUS.review,
};
const sliceTwo: TaskBlocker = {
  id: "sl2",
  name: "Batch 02 · blockers-migrate",
  status: TASK_STATUS.doing,
};
const sliceThree: TaskBlocker = {
  id: "sl3",
  name: "Batch 03 · blockers-contract",
  status: TASK_STATUS.todo,
};
const remainder: TaskBlocker = {
  id: "CuoCofyaaW",
  name: "Backend relay: Environments API routes",
  status: TASK_STATUS.later,
};

export const ChainStepWaitsForPrevious: Story = {
  name: "a chain step — blocked by the previous one, in review",
  render: () => <TaskBlockersPanel blockers={[previousStep]} projectId="prj-demo" />,
};

export const WikiStepWaitsForTwoSlices: Story = {
  name: "a batch's Wiki step — blocked by two slices, one in progress, the other todo",
  render: () => <TaskBlockersPanel blockers={[sliceTwo, sliceThree]} projectId="prj-demo" />,
};

export const BlockingRepoParentWaitsForRemainder: Story = {
  name: 'a blocking deposit — the parent waits on the remainder it filed, still in "Later"',
  render: () => <TaskBlockersPanel blockers={[remainder]} projectId="prj-demo" />,
};

export const FreeNothingToShow: Story = {
  tags: ["renders-nothing"], // deliberately empty: see stories.test.tsx
  name: "free — nothing holds it back, the panel renders nothing",
  render: () => <TaskBlockersPanel blockers={[]} projectId="prj-demo" />,
};
