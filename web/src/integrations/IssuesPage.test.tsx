// Regression: "Linear task goes to todo instead of later" (diagnostic.md, artifacts/BrETmz9BuO).
// The popup captured "Run now" unchecked (`runNow = false`) but never turned it into
// `status: TASK_STATUS.later` in `tasksApi.createTask`. Without that field the server falls back to
// `status ?? TASK_STATUS.todo`, and a `todo` task with an assigned agent is picked up by the pump
// within 30 s, without any human clicking "Run".
//
// This test mounts the real page (real router and React Query, like use-task-view.test.tsx): a
// pure-function unit test would only prove a boolean, not that the request leaves without `status`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Agent } from "../api/agents.js";
import { bootstrapApi } from "../api/bootstrap.js";
import { integrationsApi, type LinearIssue } from "../api/integrations.js";
import type { Project } from "../api/projects.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { ToastProvider } from "../ui/toast.js";
import { ISSUES_TEXT } from "./text.js";
import { QUICK_TASK_TEXT } from "../tasks/text/quick-task.js";
import { IssuesPage } from "./IssuesPage.js";
import { TASK_STATUS } from "../api/tasks.js";
import { REPO_ACCESS } from "../api/agents.js";

const project: Project = {
  id: "p1",
  name: "Atelier",
  slug: "atelier",
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

const agent: Agent = {
  id: "a1",
  projectId: "p1",
  name: "Agent A",
  title: "Developer",
  model: null,
  rolePrompt: "",
  environmentId: null,
  fsGrants: "[]",
  allowedTools: null,
  envSecretNames: "[]",
  repoAccess: REPO_ACCESS.none,
  runnerPreference: null,
  inboxAccess: false,
  browserAccess: false,
  effort: null,
  thinking: null,
  thinkingBudget: null,
  mcpServerIds: "[]",
  skillNames: "[]",
  ruleIds: "[]",
  repoNames: "[]",
};

const issue: LinearIssue = {
  id: "iss-1",
  identifier: "ABC-123",
  title: "Fix the button",
  description: "The button no longer responds.",
  url: "https://linear.app/x/issue/ABC-123",
  state: "Backlog",
  stateType: "backlog",
  project: null,
  assignee: null,
  team: null,
};

const createdTask = { id: "t-new" } as Task;

// `bootstrapQuery` (web/src/queries.ts) captures `queryFn: bootstrapApi.bootstrap`, the function
// value, when the module loads, before any `vi.spyOn` can run. A spy set in `mount()` would come too
// late: `vi.mock` is hoisted before the imports, so it is the only place that can replace it in time.
vi.mock("../api/bootstrap.js", () => ({
  bootstrapApi: { bootstrap: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** testing-library's default second is not enough here (seen on 06/09): this file passes 3 out of 3
 *  alone and failed once in the full suite on the first `findByRole`. It mounts the whole page
 *  (router, React Query, four requests resolving in cascade) while fifty-five other files set up
 *  jsdom in parallel. The wait is a scheduler wait, not a network one, and it grows with load.
 *
 *  Five seconds, not a global `retry` or a `sleep`: the test still fails if the render never comes,
 *  and returns as soon as it does. */
const WAIT = { timeout: 5_000 };

function mount() {
  vi.mocked(bootstrapApi.bootstrap).mockResolvedValue({
    projects: [project],
    agents: [agent],
    runners: [],
    templates: [],
  });
  vi.spyOn(integrationsApi, "linearIssues").mockResolvedValue([issue]);
  vi.spyOn(integrationsApi, "linearOptions").mockResolvedValue({
    members: [],
    teams: [],
    states: [],
  });
  vi.spyOn(tasksApi, "tasks").mockResolvedValue({ tasks: [], sessions: [] });
  const createTask = vi.spyOn(tasksApi, "createTask").mockResolvedValue(createdTask);
  const runTask = vi.spyOn(tasksApi, "runTask").mockResolvedValue({ sessionId: "s1" });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const issuesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/p/$projectId/issues",
    component: () => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <IssuesPage />
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const history = createMemoryHistory({ initialEntries: ["/p/p1/issues"] });
  const router = createRouter({ routeTree: rootRoute.addChildren([issuesRoute]), history });
  render(<RouterProvider router={router} />);
  return { createTask, runTask };
}

describe("Creation popup (Linear issues): unchecked 'Run now' must set status: later", () => {
  it('sends status: "later" on creation when the box is unchecked, and never runs the task', async () => {
    const { createTask, runTask } = mount();

    fireEvent.click(await screen.findByRole("button", { name: ISSUES_TEXT.list.createTask }, WAIT));

    const runNowBox = await screen.findByRole("checkbox", { name: QUICK_TASK_TEXT.runNow }, WAIT);
    expect((runNowBox as HTMLInputElement).checked).toBe(true); // checked by default
    fireEvent.click(runNowBox); // unchecked: the user chooses "later"

    fireEvent.click(screen.getByRole("button", { name: QUICK_TASK_TEXT.create("") }));

    await waitFor(() => expect(createTask).toHaveBeenCalled(), WAIT);
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({ status: TASK_STATUS.later });

    // The "later" gesture must never trigger a run, whatever `status` is sent: the second half of
    // the reported symptom ("they were executed").
    expect(runTask).not.toHaveBeenCalled();
  });
});
