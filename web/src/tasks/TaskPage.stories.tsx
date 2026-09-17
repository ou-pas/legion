// The only screen that changes FACE with the task state without changing address: todo offers to
// run, doing offers to stop, review offers to approve, and the verdict above says something
// different in each. These faces cannot be reread in production without three real sessions.
//
// The shell is mounted by its own router. It reads `projectId` and `taskId` from the URL, so the
// workshop router (root only) is not enough: the story sets its own route with the real address
// and a pre-filled cache instead of the network. Same setup as `use-task-view.test.tsx`, looking
// at the render instead of the URL.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { Session } from "../api/sessions.js";
import type { Task } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import { qk } from "../queries.js";
import { demoAgent, demoSession, demoTask } from "./task-fixture.js";
import { TaskPage } from "./TaskPage.js";

const meta = { title: "tasks / TaskPage" } satisfies Meta;
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

/** `queryFn` never resolves: what is not seeded stays pending instead of falling back to a
 *  network error. A story shows a chosen state, not a workshop failure. */
function shell(task: Task, sessions: Session[], view: ReactNode = null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, {
    projects: [project],
    agents: [demoAgent()],
    runners: [],
    templates: [],
  });
  qc.setQueryData(qk.tasks, { tasks: [task], sessions });
  qc.setQueryData(qk.task(task.id), task);
  qc.setQueryData(qk.inbox, []);
  qc.setQueryData(qk.artifacts(task.id), []);
  qc.setQueryData(qk.taskLinks(task.id), { parents: [], children: [] });
  qc.setQueryData(qk.infra, { runners: [] });

  const rootRoute = createRootRoute();
  const taskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/tasks/$taskId",
    component: () => <TaskPage />,
  });
  const viewRoute = createRoute({
    getParentRoute: () => taskRoute,
    path: "brief",
    component: () => <>{view}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([taskRoute.addChildren([viewRoute])]),
    history: createMemoryHistory({ initialEntries: [`/p/p-1/tasks/${task.id}/brief`] }),
  });
  return (
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} defaultNotFoundComponent={() => <Outlet />} />
    </QueryClientProvider>
  );
}

export const Todo: Story = {
  name: "todo — never launched, and the only action offered is to run it",
  render: () => shell(demoTask({ status: TASK_STATUS.todo, branch: null }), []),
};

export const Doing: Story = {
  name: "in progress — a session is running, the bar offers pause and stop",
  render: () =>
    shell(demoTask({ status: TASK_STATUS.doing }), [demoSession({ status: "running" })]),
};

export const InReview: Story = {
  name: "in review — approve becomes the main action",
  render: () =>
    shell(demoTask({ status: TASK_STATUS.review }), [
      demoSession({ status: "destroyed", endedAt: "2026-09-04T09:40:00.000Z", endReason: "done" }),
    ]),
};

export const WithGateAndReference: Story = {
  name: "with gate and Linear reference — the title's marks and the row of links",
  render: () =>
    shell(
      demoTask({
        status: TASK_STATUS.review,
        approvalGate: true,
        externalRef: JSON.stringify({
          provider: "linear",
          issueId: "iss-1",
          identifier: "ABC-123",
          url: "https://linear.app/x/issue/ABC-123",
        }),
      }),
      [
        demoSession({
          status: "destroyed",
          endedAt: "2026-09-04T09:40:00.000Z",
          endReason: "done",
        }),
      ],
    ),
};

export const Blocked: Story = {
  name: 'blocked — the "run" button isn\'t offered, and the panel says by whom',
  render: () =>
    shell(
      demoTask({
        status: TASK_STATUS.todo,
        branch: null,
        blockedBy: [
          { id: "t-2", name: "Write the /api/environments routes", status: TASK_STATUS.doing },
        ],
      }),
      [],
    ),
};

export const Missing: Story = {
  name: "the address points to no task — a screen that SAYS so",
  render: () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
    });
    qc.setQueryData(qk.bootstrap, { projects: [project], agents: [], runners: [], templates: [] });
    qc.setQueryData(qk.tasks, { tasks: [], sessions: [] });
    qc.setQueryData(qk.task("t-absente"), null);
    const rootRoute = createRootRoute();
    const taskRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/p/$projectId/tasks/$taskId",
      component: () => <TaskPage />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([taskRoute]),
      history: createMemoryHistory({ initialEntries: ["/p/p-1/tasks/t-absente"] }),
    });
    return (
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  },
};
