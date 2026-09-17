// The state that matters is two sessions in a row, this screen's reason to exist. The note
// explaining a failure belongs to the PREVIOUS session, and until now it was readable nowhere:
// only the goal orchestrator read it from the database.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TaskNote } from "../api/tasks.js";
import { TaskNotes } from "./task-notes.js";
import { ACTIVITY_FROM } from "../api/tasks.js";

const meta = { title: "tasks / TaskNotes" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NOW = new Date("2026-08-26T18:00:00Z").getTime();
const MIN = 60_000;

const note = (over: Partial<TaskNote> & { id: string }): TaskNote => ({
  taskId: "t-1",
  from: ACTIVITY_FROM.agent,
  body: "",
  createdAt: NOW - 5 * MIN,
  ...over,
});

export const OneNote: Story = {
  name: "one note",
  render: () => (
    <TaskNotes
      at={NOW}
      notes={[
        note({
          id: "n1",
          body: "Done. Both edge tests pass, the diff fits in 12 lines.",
        }),
      ]}
    />
  ),
};

export const TwoSessions: Story = {
  name: "two sessions — the explained failure belongs to the first",
  render: () => (
    <TaskNotes
      at={NOW}
      notes={[
        note({
          id: "n1",
          createdAt: NOW - 26 * 60 * MIN,
          body: "Stopping: the lint fails on `web/src/ui/chip.tsx`, a rule I'm not allowed to change. I'm leaving the task in review.",
        }),
        note({
          id: "n2",
          from: ACTIVITY_FROM.human,
          createdAt: NOW - 90 * MIN,
          body: "The rule is right, it's the import that's missing. Resume.",
        }),
        note({
          id: "n3",
          createdAt: NOW - 4 * MIN,
          body: "Done — the missing import was `MessagesSquare`.",
        }),
      ]}
    />
  ),
};

export const WithMarkdown: Story = {
  name: "the agent writes Markdown, and we render it",
  render: () => (
    <TaskNotes
      at={NOW}
      notes={[
        note({
          id: "n1",
          body: "Three things:\n\n- `cron.ts` is pure, tested without a clock\n- the migration is **v39**\n- a missed deadline is *never* caught up",
        }),
      ]}
    />
  ),
};

export const None: Story = {
  name: "no note — it's not a failure",
  render: () => <TaskNotes at={NOW} notes={[]} />,
};

export const AutomaticWake: Story = {
  name: "a system note — a dependency wake-up",
  render: () => (
    <TaskNotes
      at={NOW}
      notes={[
        note({
          id: "n1",
          from: ACTIVITY_FROM.system,
          createdAt: NOW - 12 * MIN,
          body: 'The awaited task "08 · Environments screen" is done. Session resumed.',
        }),
      ]}
    />
  ),
};
