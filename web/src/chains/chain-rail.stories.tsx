// The case that matters is the FIRST: a 5-step chain with 2 gates that must read without a
// legend. The two gates are marked differently: the one really blocking (step 3, in review)
// is hatched; the one not reached yet (step 5) stays a quiet "gate" pill.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type Session } from "../api/sessions.js";
import { type Task } from "../api/tasks.js";
import { ChainRail } from "./chain-rail.js";
import { type ChainRailStep } from "./chain-rail-node.js";
import { TASK_STATUS } from "../api/tasks.js";
import { COMPLEXITY } from "../api/tasks.js";
import { PRIORITY } from "../api/tasks.js";

const meta = { title: "chains / ChainRail" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const RUN = "run-checkout9x";

function step(partial: Partial<Task> & Pick<Task, "id" | "name" | "status" | "stepIndex">): Task {
  return {
    projectId: "p1",
    description: "Harden the Checkout payment webhook",
    assigneeAgentId: "a1",
    settledOutcome: null,
    modelOverride: null,
    approvalGate: false,
    readOnly: false,
    templateId: "tpl1",
    templateRunId: RUN,
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
    expectedArtifacts: '["report.md"]',
    scheduledAt: null,
    createdAt: "2026-08-26T09:00:00.000Z",
    updatedAt: "2026-08-26T09:00:00.000Z",
    boardOrder: 1,
    editable: true,
    briefEditable: true,
    waitingFor: null,
    imageWait: null,
    runnerWait: null,
    chosenRunnerId: null,
    ...partial,
  };
}

const session = (id: string, costUsd: number): Session => ({
  id,
  taskId: id,
  agentId: "a1",
  runnerId: "r1",
  model: "sonnet",
  status: "committing",
  costUsd,
  resumeCount: 0,
  startedAt: "2026-08-26T09:00:00.000Z",
  endedAt: "2026-08-26T09:04:00.000Z",
  endReason: TASK_STATUS.done,
});

const AGENTS = ["spec", "senior-dev", "review-coordinator", "infra-bot", "review-coordinator"];

const audit = step({
  id: "s1",
  name: "Step 1/5 — Audit the current flow · Harden the webhook",
  status: TASK_STATUS.done,
  stepIndex: 0,
});
const fix = step({
  id: "s2",
  name: "Step 2/5 — Make the webhook idempotent · Harden the webhook",
  status: TASK_STATUS.done,
  stepIndex: 1,
});
const review = step({
  id: "s3",
  name: "Step 3/5 — Consolidated review · Harden the webhook",
  status: TASK_STATUS.review,
  stepIndex: 2,
  approvalGate: true,
  blockedBy: [],
});
// Each step is blocked by the previous one until it is done (the s1 -> s2 link is already
// consumed). The blocker is named as the API serves it: id, name, status.
const deploy = step({
  id: "s4",
  name: "Step 4/5 — Deploy to production · Harden the webhook",
  status: TASK_STATUS.todo,
  stepIndex: 3,
  blockedBy: [{ id: review.id, name: review.name, status: review.status }],
});
const verify = step({
  id: "s5",
  name: "Step 5/5 — Verify 48h in prod before closing · Harden the webhook",
  status: TASK_STATUS.todo,
  stepIndex: 4,
  approvalGate: true,
  blockedBy: [{ id: deploy.id, name: deploy.name, status: deploy.status }],
});

const STEPS: ChainRailStep[] = [
  { task: audit, session: session("s1", 0.34), agentName: AGENTS[0], awaitedBy: [] },
  { task: fix, session: session("s2", 1.12), agentName: AGENTS[1], awaitedBy: [] },
  { task: review, session: session("s3", 0.58), agentName: AGENTS[2], awaitedBy: [deploy] },
  { task: deploy, agentName: AGENTS[3], awaitedBy: [verify] },
  { task: verify, agentName: AGENTS[4], awaitedBy: [] },
];

export const FiveStepsTwoGatesNoLegend: Story = {
  name: "5 steps, 2 gates — one gate blocks (hatching), the other waits its turn (pill)",
  render: () => (
    <div className="dsd-sheet dsd-pad">
      <ChainRail steps={STEPS} label="Chain flow: Harden the payment webhook" />
    </div>
  ),
};

export const ChainFinishedNobodyWaiting: Story = {
  name: "chain finished — nobody's waiting anymore",
  render: () => (
    <div className="dsd-sheet dsd-pad">
      <ChainRail
        label="Chain flow: Harden the payment webhook"
        steps={[
          {
            task: { ...audit, status: TASK_STATUS.done },
            session: session("s1", 0.34),
            agentName: AGENTS[0],
            awaitedBy: [],
          },
          {
            task: { ...review, status: TASK_STATUS.done, blockedBy: [] },
            session: session("s3", 0.58),
            agentName: AGENTS[2],
            awaitedBy: [],
          },
          {
            task: { ...verify, status: TASK_STATUS.done, blockedBy: [] },
            session: session("s5", 0.11),
            agentName: AGENTS[4],
            awaitedBy: [],
          },
        ]}
      />
    </div>
  ),
};
