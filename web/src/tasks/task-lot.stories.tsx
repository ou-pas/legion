// A Split step's batch and the gesture approving it. The case that matters is the FIRST: a valid
// batch of three slices with their blockers, what the operator reads just before pressing once.
// The others show the edges: a refused batch with its faults, a missing artifact, approval in
// flight, and silence.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Lot } from "../api/tasks.js";
import { TaskLotPanel } from "./task-lot.js";

const meta = { title: "tasks / TaskLotPanel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The slices of THIS piece of work, copied from a real slice spec: the real format with real
 *  labels and commands, whose length must be seen to fit. */
const lot: Lot = {
  approvesLot: true,
  faults: [],
  slices: [
    {
      label: "Blockers in a join table",
      outcome: "A task can be blocked by several tasks and is freed only by the last one.",
      validatedBy: "node --import tsx --test server/src/tasks/blockers.test.ts",
      items: [
        {
          text: "A task with two blockers stays blocked when the first one finishes",
          mode: "test",
        },
        {
          text: "The last blocker to finish frees the task once, regardless of order",
          mode: "property",
          edge: "B8/concurrency",
        },
      ],
      blockedBy: [],
    },
    {
      label: "A slice's criteria",
      outcome: "A task carries its validation command and its one to three typed criteria.",
      validatedBy: "node --import tsx --test server/src/tasks/criteria.test.ts",
      items: [
        {
          text: "Validation names every vocabulary fault, not just the first one",
          mode: "test",
        },
      ],
      blockedBy: [1],
    },
    {
      label: "The batch approval",
      outcome:
        "Approving a valid batch creates the slices, puts Wiki waiting on all of them, and ends Breakdown.",
      validatedBy: "node --import tsx --test server/src/chains/slices.test.ts",
      items: [
        { text: "Tasks are born blocked by the declared ranks", mode: "test" },
        {
          text: "The batch renders slice by slice with an approval button",
          mode: "human",
        },
        { text: "The API contract accepts the route", mode: "check" },
      ],
      blockedBy: [1, 2],
    },
  ],
};

const refused: Lot = {
  approvesLot: true,
  faults: [
    "slice 1: empty validation command",
    'slice 2: criterion 2: unknown mode "eyeball"',
    "slice 2: blocker 9: doesn't name any rank in the batch (1 to 3)",
    "cyclic blocking: slices 1, 3",
  ],
  slices: [
    { ...lot.slices[0]!, validatedBy: "", blockedBy: [3] },
    {
      ...lot.slices[1]!,
      items: [
        { text: "one criterion", mode: "test" },
        { text: "eyeball it", mode: "eyeball" },
      ],
      blockedBy: [9],
    },
    { ...lot.slices[2]!, blockedBy: [1] },
  ],
};

export const ValidBatch: Story = {
  name: "a valid batch — three slices, their blockers, one button",
  render: () => <TaskLotPanel lot={lot} onApprove={() => {}} />,
};

export const RefusedBatch: Story = {
  name: "a refused batch — all its faults named, button closed",
  render: () => <TaskLotPanel lot={refused} onApprove={() => {}} />,
};

export const MissingArtifact: Story = {
  name: "missing artifact — the fault names itself, with no slice to show",
  render: () => (
    <TaskLotPanel
      lot={{
        approvesLot: true,
        slices: [],
        faults: ["artifact slices.json missing from the run's artifacts folder"],
      }}
      onApprove={() => {}}
    />
  ),
};

export const SingleSlice: Story = {
  name: "a single slice — the title's singular, and no blocker",
  render: () => (
    <TaskLotPanel
      lot={{ approvesLot: true, faults: [], slices: [{ ...lot.slices[0]!, blockedBy: [] }] }}
      onApprove={() => {}}
    />
  ),
};

export const ApprovalInFlight: Story = {
  name: "approval in flight — the button is busy, nothing re-clicks",
  render: () => <TaskLotPanel lot={lot} busy onApprove={() => {}} />,
};

export const NotABatchStep: Story = {
  tags: ["renders-nothing"], // deliberately empty: see stories.test.tsx
  name: "not a batch step — the panel renders nothing",
  render: () => (
    <TaskLotPanel lot={{ approvesLot: false, slices: [], faults: [] }} onApprove={() => {}} />
  ),
};
