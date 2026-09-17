// The quick create popup ALONE: what the calling screen cannot prove.
//
// `IssuesPage.test.tsx` mounts the real page and checks the Linear case; it says nothing of what the
// popup does with the OTHER caller's props. Checked here is the contract between the two: external
// reference and brief go out as given, the "Run now" box alone decides between `runTask` and
// `status: later`, and a refused run leaves the task created instead of suggesting a full failure.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "../api/agents.js";
import { REPO_ACCESS } from "../api/agents.js";
import type { Project } from "../api/projects.js";
import { tasksApi, type ExternalRef, type Task } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import { qk } from "../queries.js";
import { QuickTaskModal } from "./quick-task-modal.js";
import { QUICK_TASK_TEXT } from "./text/quick-task.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
  name: "builder",
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

const externalRef: ExternalRef = {
  provider: "github-comment",
  issueId: "c-9",
  identifier: "legion#64",
  url: "https://github.com/x/legion/pull/64#discussion_r1",
  branch: "feature/steering-guard",
};

/** The cache is SEEDED rather than served by the network: `bootstrapQuery` freezes its `queryFn` at
 *  module load, so a spy set here would come too late. Setting the data directly avoids the hoisted
 *  `vi.mock` `IssuesPage.test.tsx` needs to mount the whole page. */
function mount(over: { agents?: Agent[] } = {}) {
  const createTask = vi.spyOn(tasksApi, "createTask").mockResolvedValue({ id: "t-new" } as Task);
  const runTask = vi.spyOn(tasksApi, "runTask").mockResolvedValue({ sessionId: "s1" });
  const onClose = vi.fn();

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.bootstrap, {
    projects: [project],
    agents: over.agents ?? [agent],
    runners: [],
    templates: [],
  });

  render(
    <QueryClientProvider client={qc}>
      <QuickTaskModal
        project={project}
        title="Fix task · legion#64"
        defaultName="Fix legion#64: the steering field"
        defaultGate={false}
        preview={{
          label: "Comment by operator",
          body: "The field stays mounted during committing.",
        }}
        description="Review comment by operator on legion#64"
        externalRef={externalRef}
        hint="The agent will work on the PR branch."
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { createTask, runTask, onClose };
}

const submit = () =>
  fireEvent.click(
    screen.getByRole("button", { name: QUICK_TASK_TEXT.create(QUICK_TASK_TEXT.andRun) }),
  );

describe("QuickTaskModal: what goes out on creation", () => {
  it("sends name, brief, external reference and proposed agent, then runs and closes", async () => {
    const { createTask, runTask, onClose } = mount();

    submit();

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({
      name: "Fix legion#64: the steering field",
      description: "Review comment by operator on legion#64",
      projectId: "p1",
      agentId: "a1", // no choice made: the project's first agent
      approvalGate: false,
      externalRef,
    });
    // "Run now" is ticked by default: no `status`, and the task starts.
    expect(createTask.mock.calls[0]?.[0].status).toBeUndefined();
    await waitFor(() => expect(runTask).toHaveBeenCalledWith("t-new"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('unticking "Run now" sets status: later and runs nothing', async () => {
    const { createTask, runTask } = mount();

    fireEvent.click(screen.getByRole("checkbox", { name: QUICK_TASK_TEXT.runNow }));
    fireEvent.click(screen.getByRole("button", { name: QUICK_TASK_TEXT.create("") }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({ status: TASK_STATUS.later });
    expect(runTask).not.toHaveBeenCalled();
  });

  it("ticking the approval gate goes out with the task", async () => {
    const { createTask } = mount();

    fireEvent.click(screen.getByRole("checkbox", { name: QUICK_TASK_TEXT.gate }));
    submit();

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({ approvalGate: true });
  });

  it("a refused run keeps the popup open and SAYS the task exists", async () => {
    const { createTask, onClose } = mount();
    vi.mocked(tasksApi.runTask).mockRejectedValue(new Error("no runner available"));

    submit();

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    // The task is created: the message must not suggest starting over.
    expect(
      await screen.findByText(QUICK_TASK_TEXT.launchRefused("no runner available")),
    ).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("on opening, focus is on the task field, not the cross nor the panel", () => {
    mount();
    // The field's accessible name starts with the label; <Field> appends the required marker.
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: new RegExp(`^${QUICK_TASK_TEXT.taskField}`) }),
    );
  });

  it("without an agent on the project, the button is disarmed and nothing goes out", () => {
    const { createTask } = mount({ agents: [] });

    const button = screen.getByRole("button", {
      name: QUICK_TASK_TEXT.create(QUICK_TASK_TEXT.andRun),
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(createTask).not.toHaveBeenCalled();
  });
});
