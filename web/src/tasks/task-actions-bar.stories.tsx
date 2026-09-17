// Not a row of buttons: WHICH gestures exist at each moment of a task's life. An absence is a
// decision; a greyed button would explain nothing (the native `title` does not show on a
// disabled button) while the context does. Side by side is the only way to see a gesture vanished
// from a state where it was expected.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Session } from "../api/sessions.js";
import type { Task } from "../api/tasks.js";
import { COMPLEXITY, PRIORITY, TASK_STATUS } from "../api/tasks.js";
import { TaskActionsBar, type TaskActionsBarProps } from "./task-actions-bar.js";
import type { TaskActions } from "./use-task-actions.js";

const meta = { title: "tasks / TaskActionsBar" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AT = "2026-09-04T09:00:00.000Z";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.todo,
  settledOutcome: null,
  assigneeAgentId: "a-1",
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
  templateId: null,
  templateRunId: null,
  stepIndex: null,
  blockedBy: [],
  criteria: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "",
  externalRef: null,
  expectedArtifacts: "",
  scheduledAt: null,
  branch: null,
  createdAt: AT,
  updatedAt: AT,
  boardOrder: 1,
  editable: true,
  briefEditable: true,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
  ...over,
});

const session: Session = {
  id: "s-1",
  taskId: "t-1",
  agentId: "a-1",
  runnerId: "r-1",
  model: "opus",
  status: "running",
  costUsd: 0.42,
  resumeCount: 0,
  startedAt: AT,
  endedAt: null,
  endReason: null,
};

/** The workshop calls nothing: the nine gestures are empty functions. What is checked is their
 *  PRESENCE, not their effect, which `use-task-actions.test.tsx` verifies. */
const noop = () => {};
const resolved = () => Promise.resolve();
const actions = (pending: Partial<TaskActions["pending"]> = {}): TaskActions => ({
  run: resolved,
  relaunch: resolved,
  approve: resolved,
  pause: resolved,
  stop: resolved,
  remove: resolved,
  copyTrace: noop,
  copyResume: resolved,
  approveLot: noop,
  discuss: noop,
  pending: { lot: false, discuss: false, run: false, ...pending },
});

const bar = (over: Partial<TaskActionsBarProps> = {}) => (
  <TaskActionsBar
    task={over.task ?? task()}
    session={over.session}
    active={over.active ?? false}
    sessionCount={over.sessionCount ?? 0}
    unmetPrereq={over.unmetPrereq ?? null}
    eventCount={over.eventCount ?? 0}
    pendingPr={over.pendingPr ?? false}
    canDiscuss={over.canDiscuss ?? false}
    inspectorOpen={over.inspectorOpen ?? true}
    actions={over.actions ?? actions()}
    onToggleInspector={noop}
    onOpenPr={noop}
    onMoved={noop}
    onMoveError={noop}
  />
);

export const Todo: Story = {
  name: "todo, never launched — run, move, and nothing else",
  render: () => bar({ canDiscuss: true }),
};

/** Run in progress (16/09), the spinner missing before this batch: `pending.run` drives the
 *  explicit `loading` of both variants (desktop `Button`, compact `IconBtn`), the same shared state
 *  that stops the Cmd/Ctrl+Enter shortcut from bypassing it while waiting
 *  (`use-task-actions.tsx`). */
export const Starting: Story = {
  name: "launch in progress — the button spins, desktop and compact alike",
  render: () => bar({ canDiscuss: true, actions: actions({ run: true }) }),
};

export const Doing: Story = {
  name: "a session is running — pause and stop appear, deletion is gone",
  render: () =>
    bar({ task: task({ status: TASK_STATUS.doing }), session, active: true, eventCount: 142 }),
};

export const InReview: Story = {
  name: "in review — approve becomes the main action",
  render: () =>
    bar({ task: task({ status: TASK_STATUS.review }), session, sessionCount: 1, eventCount: 142 }),
};

export const InReviewWithPrDraft: Story = {
  name: 'in review with a PR draft — "create the PR" accompanies "approve"',
  render: () =>
    bar({
      task: task({ status: TASK_STATUS.review }),
      session,
      sessionCount: 1,
      eventCount: 142,
      pendingPr: true,
    }),
};

export const PrerequisiteNotMet: Story = {
  name: "a prerequisite is asleep — approving happens in two steps",
  render: () =>
    bar({
      task: task({ status: TASK_STATUS.review }),
      session,
      sessionCount: 1,
      eventCount: 142,
      unmetPrereq: { name: "Write the /api/environments routes" },
    }),
};

export const Blocked: Story = {
  name: 'blocked by another task — the "run" button isn\'t offered',
  render: () =>
    bar({
      task: task({
        blockedBy: [{ id: "t-2", name: "Write the routes", status: TASK_STATUS.doing }],
      }),
    }),
};

export const Later: Story = {
  name: 'marked "later" — launching by hand is still allowed, it\'s an explicit action',
  render: () => bar({ task: task({ status: TASK_STATUS.later }), canDiscuss: true }),
};

export const InterviewInFlight: Story = {
  name: '"discuss first" in flight — the control disarms while waiting for the response',
  render: () => bar({ canDiscuss: true, actions: actions({ discuss: true }) }),
};

export const CollapsedPanel: Story = {
  name: "panel collapsed — the icon states the status, not just the action",
  render: () => bar({ inspectorOpen: false }),
};

export const WithSeveralSessions: Story = {
  name: "four sessions behind it — the armed deletion counts them",
  render: () =>
    bar({ task: task({ status: TASK_STATUS.review }), sessionCount: 4, eventCount: 500 }),
};
