// The composer's controls alone, outside any variant. What only they show: what HIDES. A chain
// has no complexity, priority, gate, "later" or "discuss": five controls vanish at once because
// instantiating a template runs its step 1, and a chain "in reserve" means nothing while its steps
// do not exist. A demo project hides others. These absences are decisions, only rereadable side
// by side.
//
// The provider is mounted by hand, as each variant does: the only way to look at a control
// without the bar's or modal's geometry around it.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "../api/agents.js";
import type { Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { Card } from "../ui/card.js";
import { Row, Stack } from "../ui/flex.js";
import { Field } from "../ui/form.js";
import { demoAgent } from "./task-fixture.js";
import { TaskComposer } from "./TaskComposer.js";

const meta = { title: "tasks / TaskComposer / parts" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = (over: Partial<Project> = {}): Project => ({
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
  ...over,
});

const AGENTS: Agent[] = [
  demoAgent({ id: "a-1", name: "builder" }),
  demoAgent({ id: "a-2", name: "reviewer" }),
  demoAgent({ id: "a-3", name: "spec" }),
];

/** A catalogue chain, reduced to what the composer reads: its name and steps. */
const CHAIN = {
  id: "tpl-1",
  projectId: "p-1",
  name: "Spec → Build → Verify",
  steps: [{ agentName: "spec" }, { agentName: "builder" }, { agentName: "reviewer" }],
};

/** The base, seeded rather than fetched: the workshop never calls `/api/tasks/classify`, the
 *  proposal only fires on a typing pause and nobody types here. */
function withBoot(
  children: ReactNode,
  over: { projects?: Project[]; agents?: Agent[]; templates?: unknown[] } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, {
    projects: over.projects ?? [project()],
    agents: over.agents ?? AGENTS,
    runners: [],
    templates: over.templates ?? [CHAIN],
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

export const Settings: Story = {
  name: "settings expanded — agent, complexity, priority, gate, read-only",
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Stack gap={9}>
            <TaskComposer.Name />
            <Row gap={9} wrap>
              <TaskComposer.AgentSelect />
              <TaskComposer.Complexity />
              <TaskComposer.Priority />
              <TaskComposer.Gate />
              <TaskComposer.ReadOnly />
            </Row>
          </Stack>
        </Card>
      </TaskComposer.Provider>,
    ),
};

export const SettingsWithoutChain: Story = {
  name: "no chain installed — the agent menu has only one group left",
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Row gap={9} wrap>
            <TaskComposer.AgentSelect />
            <TaskComposer.Complexity />
            <TaskComposer.Priority />
          </Row>
        </Card>
      </TaskComposer.Provider>,
      { templates: [] },
    ),
};

export const BriefAndAttachments: Story = {
  name: "the brief and its attachments — what the agent actually receives",
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Stack gap={9}>
            <Field label="Task" required>
              <TaskComposer.Name />
            </Field>
            <Field label="Brief" hint="The title alone isn't enough to do the work.">
              <TaskComposer.Detail />
            </Field>
            <TaskComposer.Attachments />
          </Stack>
        </Card>
      </TaskComposer.Provider>,
    ),
};

/** "Run" carries its shortcut hint (07/09): Enter alone no longer runs, Cmd/Ctrl+Enter does. The
 *  caption is part of <Submit>, so it follows the button everywhere. */
export const ExitButtons: Story = {
  name: "the three exits — later, discuss, run with the ⌘/Ctrl+↵ reminder",
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Row gap={9} wrap>
            <TaskComposer.Defer />
            <TaskComposer.Discuss />
            <TaskComposer.Submit />
          </Row>
        </Card>
      </TaskComposer.Provider>,
    ),
};

export const DemoProjectExits: Story = {
  name: 'on a demo project — "discuss" disappears, "run" carries its tooltip and hides its shortcut',
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Row gap={9} wrap>
            <TaskComposer.Defer />
            <TaskComposer.Discuss />
            <TaskComposer.Submit />
          </Row>
        </Card>
      </TaskComposer.Provider>,
      { projects: [project({ demo: true })] },
    ),
};

export const BothCollapsibles: Story = {
  name: "the two collapse buttons — brief and settings, closed",
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Row gap={9} wrap>
            <TaskComposer.DetailToggle />
            <TaskComposer.SettingsToggle />
          </Row>
        </Card>
      </TaskComposer.Provider>,
    ),
};

export const CollapsedSettings: Story = {
  name: "the settings row collapsed — <Settings> renders nothing until expanded",
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Stack gap={9}>
            <TaskComposer.SettingsToggle />
            <TaskComposer.Settings />
          </Stack>
        </Card>
      </TaskComposer.Provider>,
    ),
};

export const ProjectToChoose: Story = {
  name: "outside a project — the project selector appears",
  render: () =>
    withBoot(
      <TaskComposer.Provider>
        <Card>
          <Row gap={9} wrap>
            <TaskComposer.ProjectSelect />
            <TaskComposer.Name />
          </Row>
        </Card>
      </TaskComposer.Provider>,
      { projects: [project(), project({ id: "p-2", name: "Legion", slug: "legion" })] },
    ),
};
