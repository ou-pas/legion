// The form has a central switch nothing displays: `task.editable`. A started task can no longer
// be edited and the server refuses the PATCH; the screen must SAY so before the refusal, or one
// types into a field that will save nothing. That state cannot be seen in production without a
// real session, and it is the one that matters.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ModelChoice } from "../api/models.js";
import type { Project } from "../api/projects.js";
import { TASK_STATUS } from "../api/tasks.js";
import { demoAgent, demoSession, demoTask } from "./task-fixture.js";
import { TaskSettings } from "./TaskSettings.js";

const meta = { title: "tasks / TaskSettings" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

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

const AGENTS = [
  demoAgent({ id: "a-1", name: "builder" }),
  demoAgent({ id: "a-2", name: "reviewer" }),
  demoAgent({ id: "a-3", name: "spec" }),
];

const model = (id: string, displayName: string): ModelChoice => ({
  id,
  displayName,
  resolves: null,
  description: "",
  supportsEffort: true,
  effortLevels: ["low", "medium", "high"],
  supportsAdaptiveThinking: true,
});
const MODELS: ModelChoice[] = [model("opus", "Opus"), model("sonnet", "Sonnet")];

const noop = () => {};

export const Editable: Story = {
  name: "task never launched — everything is still settable",
  render: () => (
    <TaskSettings
      task={demoTask({ status: TASK_STATUS.todo, branch: null })}
      agents={AGENTS}
      project={project}
      models={MODELS}
      active={false}
      onSaved={noop}
    />
  ),
};

export const ForcedModel: Story = {
  name: "forced model — overrides complexity-based routing",
  render: () => (
    <TaskSettings
      task={demoTask({ status: TASK_STATUS.todo, modelOverride: "opus", branch: null })}
      agents={AGENTS}
      project={project}
      models={MODELS}
      active={false}
      onSaved={noop}
    />
  ),
};

export const Frozen: Story = {
  name: "task started — settings are frozen, and the screen says so before the refusal",
  render: () => (
    <TaskSettings
      task={demoTask({
        status: TASK_STATUS.doing,
        editable: false,
        briefEditable: false,
        modelOverride: "opus",
      })}
      agents={AGENTS}
      project={project}
      active
      session={demoSession({ status: "running" })}
      onSaved={noop}
    />
  ),
};

export const UnderGate: Story = {
  name: "approval gate checked — the task will stop in review",
  render: () => (
    <TaskSettings
      task={demoTask({ status: TASK_STATUS.todo, approvalGate: true, branch: null })}
      agents={AGENTS}
      project={project}
      active={false}
      onSaved={noop}
    />
  ),
};

export const ReadOnly: Story = {
  name: "read-only — repos are cloned read-only, nothing will be pushed",
  render: () => (
    <TaskSettings
      task={demoTask({ status: TASK_STATUS.todo, readOnly: true, branch: null })}
      agents={AGENTS}
      project={project}
      active={false}
      onSaved={noop}
    />
  ),
};

export const ComplexAndPriority: Story = {
  name: "complex and high priority — both groups read in the same direction",
  render: () => (
    <TaskSettings
      task={demoTask({
        status: TASK_STATUS.todo,
        complexity: "high",
        priority: "high",
        branch: null,
      })}
      agents={AGENTS}
      project={project}
      active={false}
      onSaved={noop}
    />
  ),
};

export const DeletedAgent: Story = {
  name: "the assigned agent no longer exists — the broken setting doesn't disappear silently",
  render: () => (
    <TaskSettings
      task={demoTask({ status: TASK_STATUS.todo, assigneeAgentId: "a-parti", branch: null })}
      agents={AGENTS}
      project={project}
      active={false}
      onSaved={noop}
    />
  ),
};

export const WithoutProject: Story = {
  name: "no project loaded — the form still stands without it",
  render: () => (
    <TaskSettings
      task={demoTask({ status: TASK_STATUS.todo, branch: null })}
      agents={AGENTS}
      active={false}
      onSaved={noop}
    />
  ),
};
