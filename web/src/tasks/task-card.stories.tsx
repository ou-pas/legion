// The blocked mark COUNTS ("blocked by 2") and its tooltip NAMES, on an existing chain as on a
// batch of slices or a blocking repo. A free card next to it for contrast.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Session } from "../api/sessions.js";
import type { Task, TaskBlocker } from "../api/tasks.js";
import { TaskCard } from "./task-card.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

const meta = { title: "tasks / TaskCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AT = "2026-08-28T09:00:00.000Z";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t-1",
  projectId: "p-1",
  name: "Environments screen",
  description: "",
  status: TASK_STATUS.todo,
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
  branch: null,
  goalId: null,
  archived: false,
  complexity: COMPLEXITY.med,
  priority: PRIORITY.med,
  queued: false,
  prUrls: "[]",
  externalRef: null,
  expectedArtifacts: "[]",
  scheduledAt: null,
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

const previousStep: TaskBlocker = {
  id: "s2",
  name: "Step 2/5 — Make the webhook idempotent · Harden the webhook",
  status: TASK_STATUS.review,
};
const sliceTwo: TaskBlocker = {
  id: "sl2",
  name: "Batch 02 · blockers-migrate",
  status: TASK_STATUS.doing,
};
const sliceThree: TaskBlocker = {
  id: "sl3",
  name: "Batch 03 · blockers-contract",
  status: TASK_STATUS.todo,
};
const remainder: TaskBlocker = {
  id: "CuoCofyaaW",
  name: "Backend relay: Environments API routes",
  status: TASK_STATUS.later,
};

const session: Session = {
  id: "s-1",
  taskId: "t-1",
  agentId: "a-1",
  runnerId: "r-1",
  model: "sonnet",
  status: "destroyed",
  costUsd: 0.42,
  resumeCount: 0,
  startedAt: AT,
  endedAt: "2026-08-28T09:12:00.000Z",
  endReason: TASK_STATUS.done,
};

/** A board column's width: cards read at this width, not full page. */
function Column({ children }: { children: ReactNode }) {
  return <div className="dsd-sheet dsd-pad dsd-narrow">{children}</div>;
}

export const Free: Story = {
  name: "free — nothing holds it back",
  render: () => (
    <Column>
      <TaskCard task={task()} agentName="front" />
    </Column>
  ),
};

export const ReadOnly: Story = {
  name: "read-only — audit: nothing will be pushed, no PR",
  render: () => (
    <Column>
      <TaskCard
        agentName="default"
        task={task({ name: "Validate the project install — status check", readOnly: true })}
      />
    </Column>
  ),
};

export const BlockedByChainStep: Story = {
  name: "blocked by 1 — a chain step waits on the previous one",
  render: () => (
    <Column>
      <TaskCard
        agentName="review-coordinator"
        task={task({
          name: "Step 3/5 — Consolidated review · Harden the webhook",
          templateId: "tpl1",
          templateRunId: "run-checkout9x",
          stepIndex: 2,
          approvalGate: true,
          blockedBy: [previousStep],
        })}
      />
    </Column>
  ),
};

export const BlockedByTwoSlices: Story = {
  name: "blocked by 2 — a batch's Wiki step counts the remaining slices",
  render: () => (
    <Column>
      <TaskCard
        agentName="doc-updater"
        task={task({
          name: "Step 4/5 — Wiki · The feature chain",
          templateId: "tpl-feature",
          templateRunId: "run-feature7",
          stepIndex: 3,
          blockedBy: [sliceTwo, sliceThree],
        })}
      />
    </Column>
  ),
};

export const MachineUnavailable: Story = {
  name: "machine unavailable — Docker off: the queue skipped it, not queued",
  render: () => (
    <Column>
      <TaskCard
        agentName="front"
        task={task({
          queued: true,
          runnerWait: {
            runnerId: "r-1",
            runnerName: "mini-workshop",
            reason: "docker-down",
            message:
              'Docker isn\'t responding on runner "mini-workshop": dial tcp: connection refused',
            since: Date.parse(AT),
          },
        })}
      />
    </Column>
  ),
};

export const BlockedByRepoInReview: Story = {
  name: "blocked by 1, in review — the parent waits on the remainder it filed",
  render: () => (
    <Column>
      <TaskCard
        agentName="front"
        session={session}
        task={task({ status: TASK_STATUS.review, approvalGate: true, blockedBy: [remainder] })}
      />
    </Column>
  ),
};

/** The two missing-image states (12/09). They REPLACE "queued", which lied: the chosen machine
 *  lacks the image, so nobody will pick this task up. The second applies to every task waiting for
 *  the same image: the same rebuild unblocks them all. */
export const MissingImage: Story = {
  name: "image missing — the machine doesn't have it, the queue skips it",
  render: () => (
    <Column>
      <TaskCard
        agentName="senior-dev"
        task={task({
          queued: true,
          imageWait: {
            image: "legion-session:latest",
            runnerName: "mini-workshop",
            rebuilding: false,
          },
        })}
      />
    </Column>
  ),
};

export const ImageRebuilding: Story = {
  name: "image rebuilding — two to four minutes, with its loader",
  render: () => (
    <Column>
      <TaskCard
        agentName="senior-dev"
        task={task({
          queued: true,
          imageWait: {
            image: "legion-session:latest",
            runnerName: "mini-workshop",
            rebuilding: true,
          },
        })}
      />
    </Column>
  ),
};

/** D1 (15/09): the "normal priority" row left the card at every width; the arrow joins the
 *  title's marker row, but only off the default: nothing more renders on a normal-priority card
 *  (see `Free` above). */
export const HighPriority: Story = {
  name: "high priority — the arrow joins the title's markers, no extra line",
  render: () => (
    <Column>
      <TaskCard agentName="front" task={task({ priority: PRIORITY.high })} />
    </Column>
  ),
};

export const LowPriority: Story = {
  name: "low priority — same grammar, arrow pointing down",
  render: () => (
    <Column>
      <TaskCard agentName="front" task={task({ priority: PRIORITY.low })} />
    </Column>
  ),
};
