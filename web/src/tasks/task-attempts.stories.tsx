// A task's PAST attempts, under the verdict of the one that counts.
//
// What these states protect, a distinction the database already carries: an attempt is not a
// resume. A resume UPDATEs the same session (`resumeCount + 1`, same conversation) and shows in
// THAT session's verdict; a new attempt writes a new row, and only it lands here.
//
// The "none" story is the control, and the MAJORITY case: a task run once has nothing to collapse,
// and the component must render nothing at all.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskAttempts } from "./task-attempts.js";
import { SESSION_STATUS, type Session } from "../api/sessions.js";

const meta = { title: "tasks / TaskAttempts" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const H = 3_600_000;
const base = Date.parse("2026-09-12T21:02:00Z");

function attempt(over: Partial<Session> & { id: string }): Session {
  return {
    taskId: "t1",
    agentId: "a1",
    runnerId: "r1",
    model: "sonnet",
    status: SESSION_STATUS.failed,
    costUsd: 1.31,
    resumeCount: 0,
    startedAt: new Date(base).toISOString(),
    endedAt: new Date(base + 18 * 60_000).toISOString(),
    endReason: null,
    ...over,
  };
}

/** The REAL end reasons as the server writes them: its words, never rephrased by the screen. Two
 *  failures of different kinds, an infrastructure outage and the turn wall, because that is what
 *  one opens the collapsible to read. */
const DEUX: Session[] = [
  attempt({
    id: "s1",
    endReason: 'session image missing on "mini-workshop"',
  }),
  attempt({
    id: "s2",
    costUsd: 2.1,
    startedAt: new Date(base + 2 * H).toISOString(),
    endedAt: new Date(base + 2 * H + 72 * 60_000).toISOString(),
    endReason: "200-turn wall reached (error_max_turns)",
  }),
];

export const TwoFailures: Story = {
  name: "two failed attempts — the summary reads collapsed",
  render: () => <TaskAttempts sessions={DEUX} />,
};

/** `destroyed` does NOT mean "succeeded" (`api/sessions.ts`): a stop requested by the operator
 *  lands there as a zero exit. The tone stays neutral and `endReason` decides, which an `ok` tone
 *  would have claimed instead. */
export const StoppedByOperator: Story = {
  name: '"ended" isn\'t "succeeded" — stopped by the operator',
  render: () => (
    <TaskAttempts
      sessions={[
        attempt({
          id: "s3",
          status: SESSION_STATUS.destroyed,
          costUsd: 0.84,
          endReason: "stop requested by the operator",
        }),
      ]}
    />
  ),
};

/** An attempt that itself resumed its turns: the row states its outcome; the resume count belonged
 *  to that session's verdict, which no longer exists. It is not reinvented here. */
export const WithoutReason: Story = {
  name: "no end reason — the status already said it all",
  render: () => (
    <TaskAttempts
      sessions={[attempt({ id: "s4", status: SESSION_STATUS.destroyed, endReason: null })]}
    />
  ),
};

/** An attempt that died before costing or lasting anything: no price or duration to show, and no
 *  "$0.00" to fill the row. */
export const NothingMeasured: Story = {
  name: "nothing measured — no cost, no duration, and no filler zero",
  render: () => (
    <TaskAttempts
      sessions={[attempt({ id: "s5", costUsd: null, endedAt: null, endReason: "startup stalled" })]}
    />
  ),
};

/** The MAJORITY case. A task run once has no past attempt: the component renders nothing, and
 *  that empty is the decision; a "0 attempts" collapsible would be one more object to read on
 *  every task page. */
export const None: Story = {
  name: "no past attempt — renders nothing",
  tags: ["renders-nothing"],
  render: () => <TaskAttempts sessions={[]} />,
};
