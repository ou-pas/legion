// The EMPTY column is the state that matters, and never seen on a real board: it must stay a drop
// target (otherwise dragging to a cardless column hits nothing) AND carry a sentence saying why it
// is empty. A narrow one too: the empty icon sits ABOVE the text since 04/09, because on the left
// it ate half the width.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DndContext } from "@dnd-kit/core";
import type { Session } from "../api/sessions.js";
import type { TaskSummary } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import { Button } from "../ui/button.js";
import { KanbanColumnBody } from "./kanban-column.js";
import { demoSession, demoTaskSummary } from "./task-fixture.js";

const meta = { title: "tasks / KanbanColumnBody" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const wrap = (children: ReactNode) => <DndContext>{children}</DndContext>;

const TASKS: TaskSummary[] = [
  demoTaskSummary({ id: "t-1", name: "Environments screen", status: TASK_STATUS.doing }),
  demoTaskSummary({
    id: "t-2",
    name: "Quick create popup",
    status: TASK_STATUS.doing,
    approvalGate: true,
  }),
  demoTaskSummary({
    id: "t-3",
    name: "Architecture baseline",
    status: TASK_STATUS.doing,
    readOnly: true,
  }),
];

const byId = new Map(TASKS.map((t) => [t.id, t]));
const sessions = new Map<string, Session>([["t-1", demoSession({ status: "running" })]]);
const agents = new Map(TASKS.map((t) => [t.id, "builder"]));

const EMPTY_TITLE = "Nothing in progress";
const EMPTY_WHY = 'No session is running. Run a task from "Todo" to fill this column.';

export const ThreeCards: Story = {
  name: "three cards — the order is the board's, not the database's",
  render: () =>
    wrap(
      <KanbanColumnBody
        status={TASK_STATUS.doing}
        taskIds={["t-1", "t-2", "t-3"]}
        taskById={byId}
        sessionByTaskId={sessions}
        agentNameByTaskId={agents}
        emptyTitle={EMPTY_TITLE}
        emptyWhy={EMPTY_WHY}
        renderActions={() => null}
      />,
    ),
};

export const Empty: Story = {
  name: "empty — it stays a drop target, and it says why it's empty",
  render: () =>
    wrap(
      <KanbanColumnBody
        status={TASK_STATUS.doing}
        taskIds={[]}
        taskById={byId}
        sessionByTaskId={sessions}
        agentNameByTaskId={agents}
        emptyTitle={EMPTY_TITLE}
        emptyWhy={EMPTY_WHY}
        renderActions={() => null}
      />,
    ),
};

export const WithActions: Story = {
  name: "with the column's actions — one per card, decided by the board",
  render: () =>
    wrap(
      <KanbanColumnBody
        status={TASK_STATUS.doing}
        taskIds={["t-1", "t-2"]}
        taskById={byId}
        sessionByTaskId={sessions}
        agentNameByTaskId={agents}
        emptyTitle={EMPTY_TITLE}
        emptyWhy={EMPTY_WHY}
        renderActions={(task) => <Button size="sm">Open {task.id}</Button>}
      />,
    ),
};

export const UnknownId: Story = {
  name: "an id the card can't find — a race with an invalidation, the column ignores it",
  render: () =>
    wrap(
      <KanbanColumnBody
        status={TASK_STATUS.doing}
        taskIds={["t-1", "t-supprimee", "t-2"]}
        taskById={byId}
        sessionByTaskId={sessions}
        agentNameByTaskId={agents}
        emptyTitle={EMPTY_TITLE}
        emptyWhy={EMPTY_WHY}
        renderActions={() => null}
      />,
    ),
};

export const LongColumn: Story = {
  name: "a long column — eight cards, the same density from top to bottom",
  render: function Render() {
    const many = Array.from({ length: 8 }, (_, i) =>
      demoTaskSummary({ id: `m-${i}`, name: `Task number ${i + 1}`, status: TASK_STATUS.todo }),
    );
    return wrap(
      <KanbanColumnBody
        status={TASK_STATUS.todo}
        taskIds={many.map((t) => t.id)}
        taskById={new Map(many.map((t) => [t.id, t]))}
        sessionByTaskId={new Map()}
        agentNameByTaskId={new Map(many.map((t) => [t.id, "builder"]))}
        emptyTitle={EMPTY_TITLE}
        emptyWhy={EMPTY_WHY}
        renderActions={() => null}
      />,
    );
  },
};
