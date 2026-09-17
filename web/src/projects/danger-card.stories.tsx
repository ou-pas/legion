// The card has ONE thing to get right: announcing what it destroys. An empty project and one with
// twenty-three tasks are not deleted with the same gesture, and the refusal while a session runs
// is the only moment the button is absent.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LiveSession, ProjectFootprint } from "../api/projects.js";
import { DangerCard } from "./danger-card.js";
import { demoProject } from "./project-fixture.js";

const meta = { title: "projects / DangerCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const project = demoProject({});

const footprint = (over: Partial<ProjectFootprint> = {}): ProjectFootprint => ({
  tasks: 0,
  sessions: 0,
  agents: 0,
  goals: 0,
  repos: 0,
  rules: 0,
  mcpServers: 0,
  secrets: 0,
  environments: 0,
  templates: 0,
  inbox: 0,
  ...over,
});

/** The footprint comes from a query: the workshop seeds its key instead of calling the server. */
function withFootprint(f: ProjectFootprint, live: LiveSession[], children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(["project-footprint", "p1"], { footprint: f, live });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

export const EmptyProject: Story = {
  name: "empty project — there's only its record to delete",
  render: () => withFootprint(footprint(), [], <DangerCard project={project} />),
};

export const LoadedProject: Story = {
  name: "twenty-three tasks behind it — the sentence counts them, singular and plural",
  render: () =>
    withFootprint(
      footprint({ tasks: 23, sessions: 41, inbox: 1, agents: 4, repos: 2, secrets: 1 }),
      [],
      <DangerCard project={project} />,
    ),
};

export const OneOfEach: Story = {
  name: 'one of each — the singular is hand-written, "1 inboxs" doesn\'t exist',
  render: () =>
    withFootprint(
      footprint({ tasks: 1, sessions: 1, inbox: 1, agents: 1, goals: 1, repos: 1, rules: 1 }),
      [],
      <DangerCard project={project} />,
    ),
};

export const SessionRunning: Story = {
  name: "one session working — the button is NOT offered, and we say which one",
  render: () =>
    withFootprint(
      footprint({ tasks: 23, sessions: 41 }),
      [{ id: "s-1", status: "running", taskName: "Environments screen" }],
      <DangerCard project={project} />,
    ),
};

export const SeveralSessionsRunning: Story = {
  name: "two sessions running — both are named, not just counted",
  render: () =>
    withFootprint(
      footprint({ tasks: 23, sessions: 41 }),
      [
        { id: "s-1", status: "running", taskName: "Environments screen" },
        { id: "s-2", status: "committing", taskName: "Quick create popup" },
      ],
      <DangerCard project={project} />,
    ),
};

export const FootprintNotLoadedYet: Story = {
  name: "the footprint hasn't come back yet — the card doesn't announce anything it doesn't know",
  render: () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
    });
    return (
      <QueryClientProvider client={qc}>
        <DangerCard project={project} />
      </QueryClientProvider>
    );
  },
};
