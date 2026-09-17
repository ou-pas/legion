// Both full variants: the board bar and the Cmd+K modal. Single controls, and what hides them,
// are in `task-composer-parts.stories.tsx`.
//
// What only these stories show: the same state source in two geometries. The bar fits one line
// and collapses the brief; the modal stacks and labels. Nothing else changes, which is the
// compound component's promise.
//
// The workshop never calls `/api/tasks/classify`: the proposal only fires on a typing pause and
// nobody types here. The stories seed the base (`bootstrapQuery`) and nothing else, the
// composer's real path for its agents and chains.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "../api/agents.js";
import type { Project } from "../api/projects.js";
import { qk } from "../queries.js";
import { demoAgent } from "./task-fixture.js";
import { LauncherBar, TaskComposerModal } from "./TaskComposer.js";

const meta = { title: "tasks / TaskComposer" } satisfies Meta;
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

/** The project normally comes from the URL; the workshop has no route, so the composer falls
 *  back to the first project in the list, exactly what the dashboard does. */
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

export const Bar: Story = {
  name: "the board bar — everything on one line, brief and settings collapsed",
  render: () => withBoot(<LauncherBar />),
};

export const BarWithoutChain: Story = {
  name: "the bar with no chain installed — the menu has only agents",
  render: () => withBoot(<LauncherBar />, { templates: [] }),
};

export const BarDemoProject: Story = {
  name: 'demo project — "run" stays, "discuss" is gone, nothing will actually launch',
  render: () => withBoot(<LauncherBar />, { projects: [project({ demo: true })] }),
};

export const BarWithoutAgent: Story = {
  name: "no agent on the project — the composer is there, it can't commit to anything",
  render: () => withBoot(<LauncherBar />, { agents: [], templates: [] }),
};

export const Modal: Story = {
  name: "the ⌘K modal — same fields, stacked and labeled",
  render: () => withBoot(<TaskComposerModal onClose={() => {}} />),
};

export const ModalOutsideProject: Story = {
  name: "the modal outside a project — the project selector appears",
  render: () =>
    withBoot(<TaskComposerModal onClose={() => {}} />, {
      projects: [project(), project({ id: "p-2", name: "Legion", slug: "legion" })],
    }),
};
