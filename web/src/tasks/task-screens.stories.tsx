// The views of a task, one rail row each.
//
// They had no stories, not by oversight: a view reads `useTaskShell()`, and the only path to that
// state went through the shell, a route and an SSE stream. The provider is exported since 06/09
// (`TaskPage.tsx`) and the state is set here by hand, with the type the shell derives.
//
// What to look at is the empty/filled pair. Rail rows are static: a view without content does not
// disappear, it SAYS why it is empty, a first-class state rereadable here without a session.
//
// The cache answers instead of the network, with a never-resolving `queryFn`: what is not seeded
// stays pending instead of falling back to an error.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { Project } from "../api/projects.js";
import type { TaskDiffDto } from "../api/review.js";
import type { Artifact, TaskLinks, TaskNote } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import type { Segment } from "../channels/transcript.js";
import { qk } from "../queries.js";
import { ToastProvider } from "../ui/toast.js";
import { DEMO_AT, demoAgent, demoSession, demoTask } from "./task-fixture.js";
import { TaskShellProvider, type TaskShellState } from "./TaskPage.js";
import {
  ArtifactsScreen,
  BriefScreen,
  CriteriaScreen,
  InterviewScreen,
  NotesScreen,
  PrScreen,
  ReportScreen,
  TimelineScreen,
} from "./task-screens.js";

const meta = { title: "tasks / TaskScreens" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

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
];

/** The shell state AT REST: a doing task, no session, nothing filled. Each story only changes what
 *  its view displays. */
function shellState(over: Partial<TaskShellState> = {}): TaskShellState {
  return {
    task: demoTask(),
    agent: demoAgent(),
    session: undefined,
    active: false,
    events: [],
    stream: "live",
    reconnect: noop,
    report: { text: "", available: false },
    interview: false,
    segments: [],
    hasPr: false,
    refresh: noop,
    ...over,
  };
}

/** A view mounted OUTSIDE the app router. The "/" route carries the view; the other two only exist
 *  so the links the views set (parent task, channel) know where they lead, or building their
 *  address fails. */
function view(
  node: ReactNode,
  over: Partial<TaskShellState> = {},
  seed: (qc: QueryClient) => void = noop,
) {
  const state = shellState(over);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(qk.bootstrap, {
    projects: [project],
    agents: AGENTS,
    runners: [],
    templates: [],
  });
  qc.setQueryData(qk.artifacts(state.task.id), [] satisfies Artifact[]);
  qc.setQueryData(qk.attachments(state.task.id), []);
  qc.setQueryData(qk.taskLinks(state.task.id), { parent: null, children: [] } satisfies TaskLinks);
  qc.setQueryData(["task-notes", state.task.id], [] satisfies TaskNote[]);
  seed(qc);

  const rootRoute = createRootRoute();
  const here = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <TaskShellProvider value={state}>{node}</TaskShellProvider>
        </ToastProvider>
      </QueryClientProvider>
    ),
  });
  const linked = [
    createRoute({ getParentRoute: () => rootRoute, path: "/tasks/$taskId", component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/p/$projectId/channels/$taskId",
      component: () => null,
    }),
  ];
  const router = createRouter({
    routeTree: rootRoute.addChildren([here, ...linked]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return <RouterProvider router={router} />;
}

const SEGMENTS: Segment[] = [
  {
    kind: "say",
    key: "s1",
    who: "agent",
    text: "Two questions before we start.",
    at: Date.parse(DEMO_AT),
  },
  {
    kind: "round",
    key: "r1",
    inboxId: "i-1",
    question: "Should the diff stay in the PR tab?",
    answer: "Yes, under the draft.",
    answeredAt: Date.parse(DEMO_AT) + 60_000,
  },
  {
    kind: "round",
    key: "r2",
    inboxId: "i-2",
    question: "Do we keep the rail's ten rows?",
    answer: null,
  },
];

export const InterviewEmpty: Story = {
  name: "interview — the task isn't carried by the interviewer, the view says so",
  render: () => view(<InterviewScreen />),
};

export const InterviewFilled: Story = {
  name: "interview — two rounds, one still waiting for an answer",
  render: () => view(<InterviewScreen />, { interview: true, segments: SEGMENTS }),
};

export const ReportEmpty: Story = {
  name: "report — nothing to read until the agent concludes",
  render: () => view(<ReportScreen />),
};

export const ReportFilled: Story = {
  name: "report — the agent's latest text, read as a document",
  render: () =>
    view(<ReportScreen />, {
      report: {
        available: true,
        text: "## What was done\n\nBoth text catalogs are wired up.\n\n- `TASK_PROPOSAL_TEXT`: the proposal row\n- `TASK_SETTINGS_TEXT`: the settings form\n\nNo displayed word changes.",
      },
    }),
};

const EVENTS = [
  { type: "init", data: { ts: Date.parse(DEMO_AT) } },
  { type: "tool_start", data: { tool: "Bash", ts: Date.parse(DEMO_AT) + 2_000 } },
  { type: "tool_end", data: { durationMs: 412 } },
  // The harness notice on a success: the command is not finished, it moved to another thread.
  // Without this line the trace says "done" and the next calls read an unexplained `.output` file.
  { type: "tool_start", data: { tool: "Bash", ts: Date.parse(DEMO_AT) + 3_000 } },
  {
    type: "tool_end",
    data: {
      durationMs: 120_003,
      result:
        "Command did not complete within its 120s timeout and was moved to the background " +
        "(ID: bmf0xr40p). Output is being written to: /tmp/tasks/bmf0xr40p.output.",
    },
  },
  { type: "text", data: { text: "I'm reading the catalog before touching the render." } },
  { type: "repo_push", data: { repo: "legion", commit: "5ec8874" } },
  { type: "result", data: { ts: Date.parse(DEMO_AT) + 90_000 } },
];

export const TraceNeverRun: Story = {
  name: "trace — no session has ever run",
  render: () => view(<TimelineScreen />),
};

export const TraceFilled: Story = {
  name: "trace — a finished session, its events matched",
  render: () =>
    view(<TimelineScreen />, {
      session: demoSession({ status: "destroyed", endedAt: DEMO_AT, endReason: "done" }),
      events: EVENTS,
    }),
};

export const TraceCut: Story = {
  name: "trace — the session is running and the stream cut out: the banner offers to resume",
  render: () =>
    view(<TimelineScreen />, {
      session: demoSession({ status: "running" }),
      active: true,
      stream: "closed",
      events: EVENTS,
    }),
};

const NOTES: TaskNote[] = [
  {
    id: "n-1",
    taskId: "t-1",
    from: "agent",
    body: "The classifier didn't propose anything: the brief fit in three words.",
    createdAt: Date.parse(DEMO_AT),
  },
  {
    id: "n-2",
    taskId: "t-1",
    from: "agent",
    body: "Moved to review — the diff fits in two files.",
    createdAt: Date.parse(DEMO_AT) + 600_000,
  },
];

export const NotesEmpty: Story = {
  name: "notes — the agent wrote nothing when changing status",
  render: () => view(<NotesScreen />),
};

export const NotesFilled: Story = {
  name: "notes — two sentences from the agent, across all sessions",
  render: () => view(<NotesScreen />, {}, (qc) => qc.setQueryData(["task-notes", "t-1"], NOTES)),
};

export const BriefEmpty: Story = {
  name: "brief — no instructions: the agent would only get the title",
  render: () => view(<BriefScreen />, { task: demoTask({ description: "" }) }),
};

export const BriefFilled: Story = {
  name: "brief — the written instructions, with lineage underneath",
  render: () =>
    view(
      <BriefScreen />,
      {
        task: demoTask({
          description:
            "Wire up the two text catalogs that have no reader.\n\nNo displayed word should change: hard-coded sentences are replaced by the keys that already carry them.",
        }),
      },
      (qc) =>
        qc.setQueryData(qk.taskLinks("t-1"), {
          parent: null,
          children: [
            {
              id: "t-2",
              name: "Write the stories for the nine views",
              status: TASK_STATUS.todo,
              agentName: null,
              suggestedAgentName: "builder",
              suggestedAgentId: "a-1",
              blocksParent: false,
            },
          ],
        } satisfies TaskLinks),
    ),
};

export const CriteriaEmpty: Story = {
  name: "criteria — the task has nothing written to prove upfront",
  render: () => view(<CriteriaScreen />, { task: demoTask({ criteria: null }) }),
};

export const CriteriaFilled: Story = {
  name: "criteria — the contract written upfront, one proof mode per line",
  render: () =>
    view(<CriteriaScreen />, {
      task: demoTask({
        criteria: JSON.stringify({
          validatedBy: "builder",
          items: [
            { text: "`make arch` stays at zero cycles", mode: "check" },
            { text: "The nine views render in the workshop", mode: "test" },
            { text: "No displayed word changes", mode: "human" },
          ],
        }),
      }),
    }),
};

const DIFF: TaskDiffDto = {
  branch: "feature/environments-screen",
  repos: [
    {
      repo: "legion",
      branch: "feature/environments-screen",
      error: null,
      files: [
        {
          path: "web/src/tasks/task-proposal.tsx",
          status: "modified",
          additions: 6,
          deletions: 4,
          patch: [
            "@@ -42,7 +42,7 @@",
            '   const fallback = !manual && reason === "fallback";',
            '-  const proposedWord = anyPin ? "proposed around your settings" : "proposed";',
            "+  const proposedWord = anyPin ? T.proposedAround : T.proposed;",
            "   const source = manual",
          ].join("\n"),
        },
      ],
    },
  ],
};

export const PrEmpty: Story = {
  name: "PR — nothing pushed: no draft, no diff",
  render: () => view(<PrScreen />),
};

export const PrFilled: Story = {
  name: "PR — the draft on top, the diff and its pre-review below",
  render: () =>
    view(
      <PrScreen />,
      {
        hasPr: true,
        task: demoTask({
          prUrls: JSON.stringify([{ repo: "legion", url: "https://github.com/x/legion/pull/7" }]),
        }),
      },
      (qc) => {
        qc.setQueryData(["task-diff", "t-1"], DIFF);
        qc.setQueryData(["review-comments", "t-1"], []);
      },
    ),
};

const ARTIFACTS: Artifact[] = [
  { name: "pr.md", size: 1_240, mimeType: "text/markdown", kind: "text" },
  { name: "report.md", size: 4_096, mimeType: "text/markdown", kind: "text" },
];

export const ArtifactsEmpty: Story = {
  name: "artifacts — two files expected, none filed",
  render: () =>
    view(<ArtifactsScreen />, {
      task: demoTask({ expectedArtifacts: JSON.stringify(["pr.md", "report.md"]) }),
    }),
};

export const ArtifactsFilled: Story = {
  name: "artifacts — both expected ones are there, the first opens",
  render: () =>
    view(
      <ArtifactsScreen />,
      { task: demoTask({ expectedArtifacts: JSON.stringify(["pr.md", "report.md"]) }) },
      (qc) => qc.setQueryData(qk.artifacts("t-1"), ARTIFACTS),
    ),
};
