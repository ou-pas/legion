// The task's right panel has TWO faces, and the session decides, not a tab: until something ran it
// shows the settings still changeable; once a session exists it shows the runtime and settings
// turn read-only. The switch is silent (no label names it), so side by side is the only way to
// check it still reads.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InfraRunner } from "../api/infra.js";
import type { Project } from "../api/projects.js";
import { TASK_STATUS } from "../api/tasks.js";
import { TaskInspector } from "./task-inspector.js";
import { demoAgent, demoSession, demoTask } from "./task-fixture.js";
import type { TimelineEvent } from "./trace-text.js";

const meta = { title: "tasks / TaskInspector" } satisfies Meta;
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
];

/** The panel only reads the runner's NAME, the session carries only its id. The rest of the infra
 *  DTO satisfies the type. */
const RUNNERS = [
  {
    runnerId: "r-1",
    runnerName: "machine",
    dockerHost: null,
    available: true,
    error: null,
    containers: [],
    networks: [],
    volumes: [],
    zombieSessions: [],
    image: { present: true, builtHash: "abc", currentHash: "abc", stale: false, rebuilding: false },
    sharedImages: [],
    projectImages: [],
    maxConcurrentSessions: 3,
    running: 1,
    memoryMb: 4096,
    cpus: 2,
    hostMemoryMb: 16384,
    lastSeenAt: Date.now(),
  } as unknown as InfraRunner,
];

const EVENTS: TimelineEvent[] = [
  { type: "status", data: { status: "running" } },
  { type: "tool_use", data: { name: "Read", input: { file_path: "server/src/tasks/routes.ts" } } },
  { type: "repo_push", data: { repo: "legion", branch: "feature/environments-screen" } },
];

const noop = () => {};

const LINEAR_REF = JSON.stringify({
  provider: "linear",
  issueId: "iss-1",
  identifier: "AI-2224",
  url: "https://linear.app/x/issue/AI-2224",
});

export const WithExternalReference: Story = {
  name: "Linear reference — the pill leaves the app, in the panel's head",
  render: () => (
    <TaskInspector
      task={demoTask({ status: TASK_STATUS.doing, externalRef: LINEAR_REF })}
      agents={AGENTS}
      project={project}
      session={demoSession({ status: "running" })}
      active
      events={EVENTS}
      runners={RUNNERS}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
      onStop={noop}
    />
  ),
};

export const BeforeRun: Story = {
  name: "before launch — the settings, editable",
  render: () => (
    <TaskInspector
      task={demoTask({ status: TASK_STATUS.todo, branch: null })}
      agents={AGENTS}
      project={project}
      active={false}
      events={[]}
      runners={RUNNERS}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
    />
  ),
};

/** Three `result`s on the same session: the SDK bills each resume separately, and this is the only
 *  place the detail exists. The second run is the zero-dollar API error. */
const REPRISES: TimelineEvent[] = [
  {
    type: "result",
    data: {
      subtype: "success",
      costUsd: 0.941514,
      numTurns: 2,
      durationMs: 112_000,
      durationApiMs: 98_000,
    },
  },
  {
    type: "result",
    data: {
      subtype: "success",
      costUsd: 0,
      numTurns: 1,
      isError: true,
      durationMs: 3200,
      durationApiMs: 3000,
    },
  },
  {
    type: "result",
    data: {
      subtype: "success",
      costUsd: 3.4044492,
      numTurns: 44,
      durationMs: 1_340_000,
      durationApiMs: 1_180_000,
    },
  },
];

export const ResumedSessionAndTotal: Story = {
  name: "resumed session — the per-run detail, both totals, the wall and the work",
  render: () => (
    <TaskInspector
      task={demoTask({ status: TASK_STATUS.review, editable: false, briefEditable: false })}
      agents={AGENTS}
      project={project}
      session={demoSession({ status: "destroyed", costUsd: 4.3459632 })}
      taskSessions={[
        demoSession({ id: "s-avant", status: "destroyed", costUsd: 5.2 }),
        demoSession({ status: "destroyed", costUsd: 4.3459632 }),
      ]}
      active={false}
      events={REPRISES}
      runners={RUNNERS}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
    />
  ),
};

export const DuringSession: Story = {
  name: "during the session — the runtime, and the button that stops it",
  render: () => (
    <TaskInspector
      task={demoTask({ status: TASK_STATUS.doing, editable: false, briefEditable: false })}
      agents={AGENTS}
      project={project}
      session={demoSession({ status: "running" })}
      active
      events={EVENTS}
      runners={RUNNERS}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
      onStop={noop}
    />
  ),
};

export const SessionEnded: Story = {
  name: "session ended — the runtime stays, no stop button (never greyed out, absent)",
  render: () => (
    <TaskInspector
      task={demoTask({ status: TASK_STATUS.review, editable: false, briefEditable: false })}
      agents={AGENTS}
      project={project}
      session={demoSession({
        status: "destroyed",
        endedAt: "2026-09-04T09:40:00.000Z",
        endReason: "done",
      })}
      active={false}
      events={EVENTS}
      runners={RUNNERS}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
    />
  ),
};

export const WithoutRunner: Story = {
  name: "the session's runner is no longer declared — the panel doesn't invent its name",
  render: () => (
    <TaskInspector
      task={demoTask({ status: TASK_STATUS.review, editable: false })}
      agents={AGENTS}
      project={project}
      session={demoSession({ runnerId: "r-parti" })}
      active={false}
      events={EVENTS}
      runners={RUNNERS}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
    />
  ),
};

export const ReadOnlyTask: Story = {
  name: "read-only task under gate — both setting marks",
  render: () => (
    <TaskInspector
      task={demoTask({
        status: TASK_STATUS.todo,
        readOnly: true,
        approvalGate: true,
        branch: null,
      })}
      agents={AGENTS}
      project={project}
      active={false}
      events={[]}
      runners={RUNNERS}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
    />
  ),
};

export const WithoutProject: Story = {
  name: "no project loaded — the panel still stands without it",
  render: () => (
    <TaskInspector
      task={demoTask({ status: TASK_STATUS.todo, branch: null })}
      agents={AGENTS}
      active={false}
      events={[]}
      runners={[]}
      onClose={noop}
      onSaved={noop}
      onOpenTimeline={noop}
    />
  ),
};
