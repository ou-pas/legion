// The faces of a session verdict. What shows here and nowhere else: the steering field EXISTS
// during `running` and disappears in the other two live states, with a sentence instead. Three
// side by side is the only way to check at a glance that no absence was replaced by a greyed
// control.
import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import type { InboxItem } from "../api/inbox.js";
import type { PrMergeState } from "../api/review.js";
import type { Session } from "../api/sessions.js";
import type { Task } from "../api/tasks.js";
import { TaskVerdict } from "./task-verdict.js";
import { SESSION_STATUS } from "../api/sessions.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

/** The workshop does not call the API (`prMergeStatesQuery` would query a forge that does not
 *  exist here): it SEEDS the cache key the component reads, to show a chosen state rather than
 *  "not known yet" every time. Same pattern as `initialDraft` on `PrTab`. */
function SeedMergeStates({
  taskId,
  states,
  children,
}: {
  taskId: string;
  states: PrMergeState[];
  children: ReactNode;
}) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.setQueryData(["pr-merge-state", taskId], states);
  }, [qc, taskId, states]);
  return <>{children}</>;
}

const meta = { title: "tasks / TaskVerdict" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const START = "2026-08-28T09:00:00.000Z";
const END = "2026-08-28T09:41:00.000Z";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.doing,
  assigneeAgentId: "a-1",
  modelOverride: null,
  approvalGate: false,
  readOnly: false,
  settledOutcome: null,
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
  branch: "feature/environments-screen-3f9a1c2b",
  createdAt: START,
  updatedAt: START,
  boardOrder: 1,
  editable: false,
  briefEditable: false,
  waitingFor: null,
  imageWait: null,
  runnerWait: null,
  chosenRunnerId: null,
  ...over,
});

const session = (over: Partial<Session> = {}): Session => ({
  id: "s-1",
  taskId: "t-1",
  agentId: "a-1",
  runnerId: "r-1",
  model: "claude-opus-4-5",
  status: "running",
  costUsd: 1.37,
  resumeCount: 0,
  startedAt: START,
  endedAt: null,
  endReason: null,
  ...over,
});

const ev = (type: string, data: Record<string, unknown> = {}) => ({ type, data });

/** Callbacks are inert: the workshop shows a state, it triggers nothing. */
const noop = () => {};

function Verdict(props: {
  task?: Task;
  session?: Session;
  events?: { type: string; data: Record<string, unknown> }[];
  pendingPr?: boolean;
  prUrls?: { repo: string; url: string }[];
  quotaPause?: InboxItem | null;
  steerable?: boolean;
}) {
  return (
    <TaskVerdict
      task={props.task ?? task()}
      session={props.session ?? session()}
      events={props.events ?? []}
      pendingPr={props.pendingPr ?? false}
      prUrls={props.prUrls ?? []}
      quotaPause={props.quotaPause ?? null}
      agentName="builder"
      onSteer={props.steerable === false ? undefined : () => Promise.resolve()}
      onOpenPr={noop}
      onOpenArtifacts={noop}
      onRelaunch={noop}
    />
  );
}

export const Running: Story = {
  name: "it's running — a tool in progress, and the field to talk to it",
  render: () => (
    <Verdict
      events={[ev("tool_start", { tool: "Bash", input: "pnpm -s lint", ts: Date.now() - 4000 })]}
    />
  ),
};

export const RunningWithoutTool: Story = {
  name: "it's running with no tool — the line stays, the field doesn't jump",
  render: () => <Verdict />,
};

export const Starting: Story = {
  name: "`starting` — no field, and the reason written",
  render: () => <Verdict session={session({ status: "starting" })} />,
};

export const Committing: Story = {
  name: "`committing` — no field either: it's pushing, it's not listening anymore",
  render: () => <Verdict session={session({ status: "committing" })} />,
};

export const WaitingForAnswer: Story = {
  name: "it's waiting for your answer",
  render: () => <Verdict session={session({ status: SESSION_STATUS.waiting })} />,
};

export const WaitingForDependency: Story = {
  name: "it's asleep on a dependency — it will resume on its own",
  render: () => (
    <Verdict
      session={session({ status: SESSION_STATUS.waiting })}
      task={task({
        waitingFor: {
          inboxId: "i-0",
          waitForTaskId: "t-0",
          waitForTaskName: "08 · Environments server",
          waitForTaskStatus: TASK_STATUS.doing,
          since: Date.now() - 26 * 60_000,
        },
      })}
    />
  ),
};

export const OutOfQuota: Story = {
  name: "out of quota — nobody has anything to do, the wake-up is scheduled",
  render: () => (
    <Verdict
      session={session({ status: SESSION_STATUS.waiting })}
      quotaPause={{
        id: "i-1",
        kind: "text",
        body: "subscription window exhausted",
        evidence: null,
        impact: null,
        choices: null,
        form: null,
        taskId: "t-1",
        taskName: "Environments screen",
        agentName: "builder",
        sessionId: "s-1",
        createdAt: Date.parse(START),
        wakeAt: Date.now() + 3 * 3_600_000,
        waitForTaskId: null,
        waitForTaskName: null,
        waitForTaskStatus: null,
        reason: "quota-pause",
        // v62 (07/09): an out-of-quota pause has no questionnaire, so nothing to count.
        answered: 0,
        total: 0,
        draft: null,
        draftAt: null,
        roundIndex: null,
        projectId: "p-1",
      }}
    />
  ),
};

export const AutomaticRerun: Story = {
  name: "turn budget exhausted — it resumes on its own (inertia pause, 10/09)",
  render: () => (
    <Verdict
      session={session({ status: SESSION_STATUS.waiting, resumeCount: 2 })}
      quotaPause={{
        id: "i-2",
        kind: "text",
        body: "Automatic resume #3: 175 turns consumed (paused at 175, SDK's hard wall at 200) and the session is MAKING PROGRESS — 6 commit(s) pushed, 48 successful write(s), last output at turn 173. It resumes on its own in a fresh container, on the same task and the same branch. No answer expected.",
        evidence: null,
        impact: null,
        choices: null,
        form: null,
        taskId: "t-1",
        taskName: "Environments screen",
        agentName: "builder",
        sessionId: "s-1",
        createdAt: Date.parse(START),
        wakeAt: Date.now(),
        waitForTaskId: null,
        waitForTaskName: null,
        waitForTaskStatus: null,
        reason: "turn-relaunch",
        answered: 0,
        total: 0,
        draft: null,
        draftAt: null,
        roundIndex: null,
        projectId: "p-1",
      }}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Same rail as the out-of-quota pause (`wakeAt` non-null), different cause: the "turn-relaunch" reason avoids showing "out of quota" on a turn relaunch. The resume count stays visible in the meta, alongside the rest.',
      },
    },
  },
};

export const ResumeChain: Story = {
  name: "running, after several relaunches — the count reads without opening the trace",
  render: () => <Verdict session={session({ status: "running", resumeCount: 3 })} />,
  parameters: {
    docs: {
      description: {
        story:
          "Criterion 8 of the inertia pause: `resumeCount` reads in the meta while the session is still running, not only once it's done.",
      },
    },
  },
};

export const Succeeded: Story = {
  name: "finished successfully — what was pushed",
  render: () => (
    <Verdict
      session={session({ status: "destroyed", endedAt: END })}
      events={[
        ev("result", { subtype: "success", numTurns: 34, costUsd: 1.37 }),
        ev("repo_push", { repo: "legion", changes: 12, commit: "a1b2c3d" }),
      ]}
    />
  ),
};

export const PendingDraft: Story = {
  name: "finished, a PR draft is waiting for a decision",
  render: () => (
    <Verdict
      pendingPr
      session={session({ status: "destroyed", endedAt: END })}
      events={[ev("result", { subtype: "success", numTurns: 21 })]}
    />
  ),
};

export const Failure: Story = {
  name: "stopped before the end — the cause first, then the action",
  render: () => (
    <Verdict
      session={session({ status: "failed", endedAt: END, endReason: "token budget exhausted" })}
      events={[ev("run_error", { message: "the container exited with 137" })]}
    />
  ),
};

export const FailureBlocked: Story = {
  name: "failure on a blocked task — retry isn't offered",
  render: () => (
    <Verdict
      task={task({
        blockedBy: [
          {
            id: "t-0",
            name: "Backend relay: Environments API routes",
            status: TASK_STATUS.later,
          },
        ],
      })}
      session={session({ status: "failed", endedAt: END })}
      events={[ev("run_error", { message: "unresolved dependency" })]}
    />
  ),
};

export const NeverRun: Story = {
  tags: ["renders-nothing"], // deliberately empty: see stories.test.tsx
  name: "no session — the verdict renders nothing",
  render: () => (
    <TaskVerdict
      task={task({ status: TASK_STATUS.todo })}
      events={[]}
      pendingPr={false}
      prUrls={[]}
      quotaPause={null}
      onOpenPr={noop}
      onOpenArtifacts={noop}
      onRelaunch={noop}
    />
  ),
};

export const OpenPr: Story = {
  name: "finished, a PR open — the verdict shows the PR without the merge state",
  render: () => (
    <Verdict
      session={session({ status: "destroyed", endedAt: END })}
      prUrls={[{ repo: "legion", url: "https://github.com/x/legion/pull/42" }]}
      events={[ev("result", { subtype: "success", numTurns: 34, costUsd: 1.37 })]}
    />
  ),
};

const FRONT_MR_URL = "https://framagit.org/3idprint/front/-/merge_requests/15";
const API_MR_URL = "https://framagit.org/3idprint/api/-/merge_requests/22";
const SOLIDARITY_PR_URLS = [
  { repo: "front", url: FRONT_MR_URL },
  { repo: "api", url: API_MR_URL },
];

// Real case of 03/09: a two-repo task (framagit api + front) opens two change requests, and
// nothing said they were TIED: the operator merges one and does not understand why the task stays
// in review. `front` merged, `api` waits: the count AND the name.
export const TiedOneWaits: Story = {
  name: "two requests, one merged — the count, and which one is waiting",
  render: () => (
    <SeedMergeStates
      taskId="t-1"
      states={[
        {
          repo: "front",
          url: FRONT_MR_URL,
          number: 15,
          mergeState: "mergeable",
          prState: "merged",
        },
        { repo: "api", url: API_MR_URL, number: 22, mergeState: "mergeable", prState: "open" },
      ]}
    >
      <Verdict
        session={session({ status: "destroyed", endedAt: END })}
        prUrls={SOLIDARITY_PR_URLS}
        events={[ev("result", { subtype: "success", numTurns: 34, costUsd: 1.37 })]}
      />
    </SeedMergeStates>
  ),
};

// The unknown state (`prState` absent: unreadable number, unresolved repo) is NOT "not merged
// yet": it asks to look why, not to wait.
export const TiedStateUnknown: Story = {
  name: "two requests, one not known yet — to look at, not to wait on",
  render: () => (
    <SeedMergeStates
      taskId="t-1"
      states={[
        {
          repo: "front",
          url: FRONT_MR_URL,
          number: 15,
          mergeState: "mergeable",
          prState: "merged",
        },
        { repo: "api", url: API_MR_URL, number: null, mergeState: "unknown" }, // no prState
      ]}
    >
      <Verdict
        session={session({ status: "destroyed", endedAt: END })}
        prUrls={SOLIDARITY_PR_URLS}
        events={[ev("result", { subtype: "success", numTurns: 34, costUsd: 1.37 })]}
      />
    </SeedMergeStates>
  ),
};
