// A task's contract on screen. The case that matters is the FIRST: a split slice with its three
// criteria and their three modes, what the operator will judge one by one. The others show the
// block's edges: a single criterion, a remainder, and the two ways to render nothing.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskCriteriaPanel } from "./task-criteria.js";

const meta = { title: "tasks / TaskCriteriaPanel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The criteria of THIS slice, copied from a real slice spec: the real format
 *  with real long texts, whose length must be seen to fit. */
const slice = JSON.stringify({
  validatedBy:
    "node --import tsx --test server/src/tasks/criteria.test.ts && pnpm -s --filter @legion/web test",
  items: [
    {
      text: "A slice's criteria validation names every vocabulary fault, all at once, in field order then once per ascending value.",
      mode: "test",
    },
    {
      text: "Through the internal API, on a task with criteria, done is refused, doing from review is refused, review from review is accepted with no effect.",
      mode: "property",
      edge: "B9/idempotency",
    },
    {
      text: "The task page shows the validation command then the criteria numbered 1 to 3 with their mode, in order.",
      mode: "human",
    },
  ],
});

const single = JSON.stringify({
  validatedBy: "make gates",
  items: [
    {
      text: "The wiki page describing chains describes `feature`, its gates, and what a slice is.",
      mode: "check",
    },
  ],
});

const remainder = JSON.stringify({
  validatedBy: "pnpm -s test",
  items: [
    { text: "The remainder carries the unmet criteria with their modes.", mode: "test" },
    { text: "The edges ↔ criteria cross-check waits for tier 2.", mode: "waived" },
  ],
});

export const SliceWithThreeCriteria: Story = {
  name: "a breakdown slice — three criteria, three modes, numbered 1 to 3",
  render: () => <TaskCriteriaPanel criteria={slice} />,
};

export const SingleCriterion: Story = {
  name: "a single criterion — the vocabulary's lower bound (one to three)",
  render: () => <TaskCriteriaPanel criteria={single} />,
};

export const Remainder: Story = {
  name: "a remainder — what a partial slice filed, including one discarded criterion",
  render: () => <TaskCriteriaPanel criteria={remainder} />,
};

export const WithoutCriteria: Story = {
  tags: ["renders-nothing"], // deliberately empty: see stories.test.tsx
  name: "no criteria — the ordinary task, the panel renders nothing",
  render: () => <TaskCriteriaPanel criteria={null} />,
};

export const UnreadableColumn: Story = {
  tags: ["renders-nothing"], // deliberately empty: see stories.test.tsx
  name: "unreadable column — unknown mode: nothing rather than a blank screen",
  render: () => (
    <TaskCriteriaPanel criteria='{"validatedBy":"x","items":[{"text":"t","mode":"eyeball"}]}' />
  ),
};
