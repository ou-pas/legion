// Rewritten in CSF3 on 26/08. The first version exported bare React components without
// `export default meta`, and Storybook refused to start on it ("Unable to index
// ./src/schedules/schedules.stories.tsx"): the workshop was dead for everyone from PR #50 on.
//
// The four states that matter are those of a trigger, because they answer "it did not run last
// night": a task created, a rule disabled, a missed due time, an error.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Schedule, ScheduleRun } from "../api/schedules.js";
import { Stack } from "../ui/flex.js";
import { List } from "../ui/list.js";
import { ScheduleRow } from "./schedule-row.js";
import { ScheduleDetailCard } from "./schedule-detail-card.js";
import { ScheduleRunItem } from "./schedule-run-item.js";
import { SCHEDULE_OUTCOME } from "../api/schedules.js";

const meta = { title: "schedules / Scheduled" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const H = 60 * 60 * 1000;
// A fixed instant: a story reading the clock renders different text each time it opens, and
// "2h ago" becomes "3h ago" without a line of code changing.
const NOW = new Date("2026-08-26T12:00:00Z").getTime();

const SCHEDULE: Schedule = {
  id: "sch-1",
  projectId: "proj-1",
  name: "Morning standup",
  cron: "0 9 * * 1-5",
  agentId: "agent-standup",
  templateId: null,
  prompt: "Summarize what's changed since yesterday.",
  enabled: true,
  lastRunAt: NOW - 24 * H,
  nextRunAt: NOW + 24 * H,
  createdAt: NOW - 30 * 24 * H,
};

const DISABLED: Schedule = {
  ...SCHEDULE,
  id: "sch-2",
  name: "Nightly sync",
  cron: "30 2 * * *",
  enabled: false,
  lastRunAt: NOW - 7 * 24 * H,
  nextRunAt: null,
};

const run = (over: Partial<ScheduleRun>): ScheduleRun => ({
  id: "run-1",
  scheduleId: "sch-1",
  firedAt: NOW - H,
  outcome: SCHEDULE_OUTCOME.taskCreated,
  taskId: null,
  reason: null,
  ...over,
});

const RUNS: ScheduleRun[] = [
  run({ id: "r1", firedAt: NOW - H, outcome: SCHEDULE_OUTCOME.taskCreated, taskId: "task-123" }),
  run({
    id: "r2",
    firedAt: NOW - 2 * H,
    outcome: SCHEDULE_OUTCOME.taskCreated,
    taskId: "task-122",
  }),
  run({ id: "r3", firedAt: NOW - 3 * H, outcome: SCHEDULE_OUTCOME.skippedDisabled }),
  run({ id: "r4", firedAt: NOW - 24 * H, outcome: SCHEDULE_OUTCOME.skippedMissed }),
  run({
    id: "r5",
    firedAt: NOW - 25 * H,
    outcome: SCHEDULE_OUTCOME.error,
    reason: 'The "standup" agent no longer exists in this project',
  }),
];

export const OneRule: Story = {
  name: "an active rule — cron, next run, last run",
  render: () => (
    <List label="Scheduled">
      <ScheduleRow schedule={SCHEDULE} />
    </List>
  ),
};

export const EnabledAndDisabled: Story = {
  name: "active and disabled — the disabled one has no next run",
  render: () => (
    <List label="Scheduled">
      <ScheduleRow schedule={SCHEDULE} />
      <ScheduleRow schedule={DISABLED} />
    </List>
  ),
};

export const RuleDetail: Story = {
  name: "the detail with its last five triggers",
  render: () => <ScheduleDetailCard schedule={SCHEDULE} runs={RUNS} projectId="proj-1" />,
};

export const DetailWithoutHistory: Story = {
  name: "a rule that's never run — it's not a failure",
  render: () => (
    <ScheduleDetailCard schedule={{ ...SCHEDULE, lastRunAt: null }} runs={[]} projectId="proj-1" />
  ),
};

// The four outcomes of a due time, one by one. Without them a silent rule and a broken rule
// look the same.
export const TriggerSucceeded: Story = {
  name: "trigger · the task was created",
  render: () => (
    <ScheduleRunItem
      run={run({ outcome: SCHEDULE_OUTCOME.taskCreated, taskId: "task-123" })}
      projectId="proj-1"
    />
  ),
};

export const TriggerDisabled: Story = {
  name: "trigger · the rule was disabled",
  render: () => (
    <ScheduleRunItem run={run({ outcome: SCHEDULE_OUTCOME.skippedDisabled })} projectId="proj-1" />
  ),
};

export const TriggerMissed: Story = {
  name: "trigger · missed, server off — never caught up",
  render: () => (
    <ScheduleRunItem
      run={run({ outcome: SCHEDULE_OUTCOME.skippedMissed, firedAt: NOW - 24 * H })}
      projectId="proj-1"
    />
  ),
};

export const TriggerFailed: Story = {
  name: "trigger · errored, with its reason spelled out",
  render: () => (
    <ScheduleRunItem
      run={run({
        outcome: SCHEDULE_OUTCOME.error,
        reason: 'The "standup" agent no longer exists in this project',
      })}
      projectId="proj-1"
    />
  ),
};

export const Everything: Story = {
  name: "the four outcomes in a row",
  render: () => (
    <Stack gap={10}>
      {RUNS.map((r) => (
        <ScheduleRunItem key={r.id} run={r} projectId="proj-1" />
      ))}
    </Stack>
  ),
};
