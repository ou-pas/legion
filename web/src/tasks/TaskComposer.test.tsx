// The composer PROVIDER: what really goes out on click.
//
// 225 lines of decisions without a single test, half of them invisible on screen: the brief is only
// sent when written, the "later" box does not merely skip the run (it sets `status: later`, or the
// pump takes the task within 30 s), and "discuss" does NOT create the work task, it creates the
// interview preceding it, with another agent and another prompt.
//
// The test mounts the provider with BARE pieces rather than the whole bar: what is checked is the
// contract between controls and API, not the bar layout, which lives in the stories.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Agent } from "../api/agents.js";
import type { Project } from "../api/projects.js";
import { tasksApi, type Task } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import * as startInterview from "../interviews/start-interview.js";
import { INTERVIEW_TEXT } from "../interviews/text.js";
import { qk } from "../queries.js";
import { ENTER, MOD } from "../ui/platform.js";
import { ToastProvider } from "../ui/toast.js";
import { demoAgent } from "./task-fixture.js";
import { TaskComposer } from "./TaskComposer.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project: Project = {
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

const AGENTS: Agent[] = [
  demoAgent({ id: "a-1", name: "builder" }),
  demoAgent({ id: "a-2", name: "reviewer" }),
];

/** The composer head, reduced to what is driven here: title, brief, settings, and the three exits.
 *  The router is there for `useProject()`, which reads URL params. */
function mount(over: { agents?: Agent[]; demo?: boolean } = {}) {
  const createTask = vi.spyOn(tasksApi, "createTask").mockResolvedValue({ id: "t-new" } as Task);
  const runTask = vi.spyOn(tasksApi, "runTask").mockResolvedValue({ sessionId: "s-1" });
  const uploadAttachment = vi.spyOn(tasksApi, "uploadAttachment");
  const interview = vi
    .spyOn(startInterview, "startInterview")
    .mockResolvedValue({ taskId: "t-int", installed: false, queued: null });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(qk.bootstrap, {
    projects: [{ ...project, demo: over.demo ?? false }],
    agents: over.agents ?? AGENTS,
    runners: [],
    templates: [],
  });

  const rootRoute = createRootRoute({
    component: () => (
      <TaskComposer.Provider>
        <TaskComposer.Name />
        <TaskComposer.Detail />
        <TaskComposer.AgentSelect />
        <TaskComposer.Complexity />
        <TaskComposer.Gate />
        <TaskComposer.ReadOnly />
        <TaskComposer.Defer />
        <TaskComposer.Discuss />
        <TaskComposer.Submit />
      </TaskComposer.Provider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { createTask, runTask, uploadAttachment, interview };
}

const WAIT = { timeout: 5_000 };

const title = () => screen.findByLabelText("Describe the task", {}, WAIT);
const brief = () => screen.getByLabelText("Task brief");
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("TaskComposer.Provider: run", () => {
  it("sends title, project, agent and settings, then runs", async () => {
    const { createTask, runTask } = mount();

    fireEvent.change(await title(), { target: { value: "  Environments screen  " } });
    click("Run");

    await waitFor(() => expect(createTask).toHaveBeenCalled(), WAIT);
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({
      name: "Environments screen", // trimmed: a title with spaces is not another title
      projectId: "p-1",
      agentId: "a-1",
      approvalGate: false,
      readOnly: false,
      complexity: "med",
      priority: "med",
    });
    // Without a written brief, no `description`: the server has its own default, and an empty string
    // would overwrite a description set otherwise.
    expect(createTask.mock.calls[0]?.[0].description).toBeUndefined();
    expect(createTask.mock.calls[0]?.[0].status).toBeUndefined();
    await waitFor(() => expect(runTask).toHaveBeenCalledWith("t-new"), WAIT);
  });

  it("sends the brief when written: IT is the agent's instruction", async () => {
    const { createTask } = mount();

    fireEvent.change(await title(), { target: { value: "Environments screen" } });
    fireEvent.change(brief(), { target: { value: "The four routes do not exist yet." } });
    click("Run");

    await waitFor(() => expect(createTask).toHaveBeenCalled(), WAIT);
    expect(createTask.mock.calls[0]?.[0].description).toBe("The four routes do not exist yet.");
  });

  // PINNING a setting takes over from the classifier for THAT field; it keeps proposing the others
  // around it. Both boxes are driven by keyboard as by mouse, so the test goes through them: design
  // system selectors are drawn listboxes (`ui/select.tsx`), and opening them here would make this a
  // design system test.
  it("a touched setting goes out as is: the ticked box is not overwritten", async () => {
    const { createTask } = mount();

    fireEvent.change(await title(), { target: { value: "Harness audit" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Approval gate" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Read-only" }));
    click("Run");

    await waitFor(() => expect(createTask).toHaveBeenCalled(), WAIT);
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({ approvalGate: true, readOnly: true });
  });

  it("an empty title commits nothing: the button stays disarmed", async () => {
    const { createTask } = mount();

    const button = await screen.findByRole("button", { name: "Run" }, WAIT);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(createTask).not.toHaveBeenCalled();
  });
});

// The run key (07/09). Enter in the title field used to run the task: an agent, a container and cost
// for a stray line break. Same convention as the inbox (ui/submit-key.ts): plain Enter does nothing,
// ⌘/Ctrl+Enter runs, and the composer says so next to "Run".
describe("TaskComposer.Provider: the run key", () => {
  it("plain Enter runs nothing; ⌘+Enter runs, and a single task goes out", async () => {
    const { createTask, runTask } = mount();

    const input = await title();
    fireEvent.change(input, { target: { value: "Environments screen" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    // One call: had plain Enter run, there would be two, or the double-submit guard would have
    // swallowed one, which means not knowing which one ran.
    await waitFor(() => expect(runTask).toHaveBeenCalledWith("t-new"), WAIT);
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it('shows the shortcut on "Run", even disarmed with an empty title (D5)', async () => {
    mount();

    const button = await screen.findByRole("button", { name: "Run" }, WAIT);
    expect(button.querySelector(".ui-btn-shortcut")?.textContent).toBe(MOD + ENTER);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  // The brief is the SAME data as the title (task.description): the gesture running from one must run
  // from the other (D1, 15/09).
  it("from the brief too: plain Enter runs nothing, ⌘+Enter runs", async () => {
    const { createTask, runTask } = mount();

    fireEvent.change(await title(), { target: { value: "Environments screen" } });
    fireEvent.keyDown(brief(), { key: "Enter" });
    fireEvent.keyDown(brief(), { key: "Enter", metaKey: true });

    await waitFor(() => expect(runTask).toHaveBeenCalledWith("t-new"), WAIT);
    expect(createTask).toHaveBeenCalledTimes(1);
  });
});

describe("TaskComposer.Provider: save for later", () => {
  it("sets `status: later` and runs NOTHING", async () => {
    const { createTask, runTask } = mount();

    fireEvent.change(await title(), { target: { value: "An idea for later" } });
    click("Save for later");

    await waitFor(() => expect(createTask).toHaveBeenCalled(), WAIT);
    expect(createTask.mock.calls[0]?.[0]).toMatchObject({ status: TASK_STATUS.later });
    expect(runTask).not.toHaveBeenCalled();
  });

  it("clears the composer afterwards: a field surviving a submit goes out twice", async () => {
    mount();

    const input = await title();
    fireEvent.change(input, { target: { value: "An idea for later" } });
    click("Save for later");

    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""), WAIT);
  });
});

describe("TaskComposer.Provider: discuss first", () => {
  it("opens an INTERVIEW instead of creating the work task", async () => {
    const { createTask, interview } = mount();

    fireEvent.change(await title(), { target: { value: "Refondre l'inbox" } });
    fireEvent.change(brief(), { target: { value: "I do not know what I want yet." } });
    click(INTERVIEW_TEXT.start.label);

    await waitFor(() => expect(interview).toHaveBeenCalled(), WAIT);
    expect(interview.mock.calls[0]?.[0]).toMatchObject({
      projectId: "p-1",
      subject: "Refondre l'inbox",
      brief: "I do not know what I want yet.",
    });
    // Neither the proposed agent, nor complexity, nor gate concern the interview: a different job,
    // with its own model.
    expect(createTask).not.toHaveBeenCalled();
  });

  it('on a demo project, "discuss" is not offered at all', async () => {
    mount({ demo: true });

    await title();
    expect(screen.queryByRole("button", { name: INTERVIEW_TEXT.start.label })).toBeNull();
  });

  it('on a demo project, "Run" does not show the shortcut: it runs nothing', async () => {
    mount({ demo: true });

    const button = await screen.findByRole("button", { name: "Run" }, WAIT);
    expect(button.querySelector(".ui-btn-shortcut")).toBeNull();
  });
});
