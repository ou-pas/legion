// The empty board is not a workshop accident: it is what someone who just created a project
// sees, and each column must then say something useful rather than stay grey. The other state
// only seen here is the LOADED board, three full columns side by side, checking density holds
// and a card stays readable in a narrow column.
//
// The board reads four queries and the project from the URL; the workshop seeds the four and
// leaves the project `null`, exactly the global dashboard state: no project filter, all tasks.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { userEvent } from "storybook/test";
import type { Session } from "../api/sessions.js";
import type { TaskSummary } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import { qk } from "../queries.js";
import { Board } from "./Board.js";
import { demoAgent, demoSession, demoTaskSummary } from "./task-fixture.js";

const meta = { title: "tasks / Board" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = {
  id: "p-1",
  name: "Acme",
  slug: "acme",
  defaultModel: "sonnet",
  repoUrl: null,
  fsRoot: null,
  context: "",
  demo: false,
  gitAuthorName: null,
  gitAuthorEmail: null,
  defaultSkillNames: "[]",
  modelRouting: "{}",
  chainBindings: "{}",
  sessionImage: null,
  sessionDockerfile: null,
  sshKeyPath: null,
  hue: null,
};

const task = (
  id: string,
  name: string,
  status: TaskSummary["status"],
  over: Partial<TaskSummary> = {},
) => demoTaskSummary({ id, name, status, branch: null, ...over });

const TASKS: TaskSummary[] = [
  task("t-1", "Resolve the duplication in the creation popup", TASK_STATUS.todo),
  task("t-2", "Lay down the architecture baseline", TASK_STATUS.todo, { approvalGate: true }),
  task("t-3", "Environments screen", TASK_STATUS.doing, {
    branch: "feature/environments-screen",
  }),
  task("t-4", "Extract the settings cards", TASK_STATUS.doing, { branch: "feature/cards" }),
  task("t-5", "Markdownish renders GFM tables", TASK_STATUS.review, {
    branch: "feature/markdownish",
  }),
  task("t-6", "Check the git identity", TASK_STATUS.done, { branch: "feature/git-identity" }),
  task("t-7", "Rethink the inbox as a channel", TASK_STATUS.later, { readOnly: true }),
];

const SESSIONS: Session[] = [
  demoSession({ id: "s-3", taskId: "t-3", status: "running" }),
  demoSession({ id: "s-4", taskId: "t-4", status: "waiting" }),
  demoSession({
    id: "s-5",
    taskId: "t-5",
    status: "destroyed",
    endedAt: "2026-09-04T09:40:00.000Z",
    endReason: "done",
  }),
];

/** `queryFn` never resolves: what is not seeded stays pending rather than falling back to a
 *  network error. */
function withBoard(tasks: TaskSummary[], sessions: Session[], children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, {
    projects: [project],
    agents: [demoAgent({ id: "a-1", name: "builder" })],
    runners: [],
    templates: [],
  });
  qc.setQueryData(qk.tasks, { tasks, sessions });
  qc.setQueryData(qk.inbox, []);
  qc.setQueryData(qk.infra, { runners: [] });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

export const Loaded: Story = {
  name: "a board in motion — five columns, three full",
  render: () => withBoard(TASKS, SESSIONS, <Board />),
};

export const Empty: Story = {
  name: "a new project — each column says something rather than staying grey",
  render: () => withBoard([], [], <Board />),
};

export const OnlyIdeas: Story = {
  name: 'nothing but "later" — no agent will pick them up until they\'re committed',
  render: () =>
    withBoard(
      [
        task("t-10", "Rethink the inbox as a channel", TASK_STATUS.later),
        task("t-11", "An offline mode for the docs", TASK_STATUS.later),
        task("t-12", "Measure cost per chain", TASK_STATUS.later),
      ],
      [],
      <Board />,
    ),
};

export const OneLoadedColumn: Story = {
  name: "one column much longer than the others — height doesn't follow the tallest",
  render: () =>
    withBoard(
      Array.from({ length: 9 }, (_, i) => task(`m-${i}`, `Task number ${i + 1}`, TASK_STATUS.todo)),
      [],
      <Board />,
    ),
};

// The arrival lane tints while hovered (decision 4, board.md 15/09), chosen on paper and never
// seen before implementation. The `play` function replays the `drag-board.mjs` gesture (last Todo
// card pushed towards Doing at constant height) WITHOUT releasing the button, so the workshop
// stays on the mid-drag state that the capture judges.
export const TintedArrivalLane: Story = {
  name: "a drop in progress — the target lane tints, the origin stays neutral",
  render: () =>
    withBoard(
      Array.from({ length: 9 }, (_, i) => task(`m-${i}`, `Task number ${i + 1}`, TASK_STATUS.todo)),
      [],
      <Board />,
    ),
  play: async ({ canvasElement }) => {
    const cols = canvasElement.querySelectorAll(".ui-grid > .ui-inset");
    const cards = cols[1]?.querySelectorAll(".ui-sortable-card") ?? [];
    const last = cards[cards.length - 1];
    const doing = cols[2];
    if (!last || !doing) return; // compact tier (a single lane rendered): nothing to play here
    const from = last.getBoundingClientRect();
    const to = doing.getBoundingClientRect();
    const y = from.y + from.height / 2;
    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: last, coords: { x: from.x + from.width / 2, y } },
      { coords: { x: from.x + from.width / 2 + 20, y } },
      { coords: { x: to.x + to.width / 2, y } },
    ]);
    // No release: the gesture stays in the air so the tint stays visible.
  },
};

export const WithBlockers: Story = {
  name: "tasks waiting on each other — the card counts, the page names",
  render: () =>
    withBoard(
      [
        task("t-20", "Write the /api/environments routes", TASK_STATUS.doing, {
          branch: "feature/routes",
        }),
        task("t-21", "Environments screen", TASK_STATUS.todo, {
          blockedBy: [
            { id: "t-20", name: "Write the /api/environments routes", status: TASK_STATUS.doing },
          ],
        }),
      ],
      [demoSession({ id: "s-20", taskId: "t-20", status: "running" })],
      <Board />,
    ),
};
