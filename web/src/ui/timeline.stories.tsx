// The vocabulary is the runner's, untranslated. A tool call collapses to one line; hatching is used
// only here, for a write refusal and an execution failure.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./chip.js";
import { CodeBlock } from "./code.js";
import { Stack } from "./flex.js";
import { Num } from "./num.js";
import { Timeline, TimelineItem } from "./timeline.js";

const meta = { title: "ui / Timeline · TimelineItem" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SessionTrace: Story = {
  name: "session trace",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-sheet">
          <Timeline label='Trace for the "Update security dependencies" session'>
            <TimelineItem
              time="14:02:11"
              kind="init"
              summary={
                <>
                  model <Tag>claude-sonnet-5</Tag>, API key inherited from the subscription
                </>
              }
            >
              <CodeBlock label="payload init">
                {'{"model":"claude-sonnet-5","apiKeySource":"none"}'}
              </CodeBlock>
            </TimelineItem>
            <TimelineItem
              time="14:02:12"
              kind="status"
              summary="running · limited network · claude-haiku-4-5"
            />
            <TimelineItem
              time="14:02:18"
              kind="repo_ready"
              summary={
                <>
                  front ready in <Tag>./repos/front</Tag> on <Tag>legion/checkout</Tag>
                </>
              }
            />
            <TimelineItem
              time="14:03:02"
              kind="tool_start"
              summary={
                <>
                  Read <Tag>/repos/front/src/checkout/PaymentForm.tsx</Tag> ·{" "}
                  <Num value={3821} suffix="ms" tone="muted" />
                </>
              }
            >
              <CodeBlock label="tool input">
                {'{"tool":"Read","input":"/repos/front/src/checkout/PaymentForm.tsx"}'}
              </CodeBlock>
            </TimelineItem>
            <TimelineItem
              time="14:03:06"
              kind="tool_end"
              defaultOpen
              summary={
                <>
                  finished in <Num value={3821} suffix="ms" tone="muted" /> — expanded
                </>
              }
            >
              <CodeBlock label="tool output">{'{"durationMs":3821}'}</CodeBlock>
            </TimelineItem>
            <TimelineItem
              time="14:05:44"
              kind="fs_denied"
              summary={
                <>
                  write refused on <Tag>/repos/front/package.json</Tag> — outside the granted
                  folders
                </>
              }
            >
              <CodeBlock label="payload fs_denied">
                {
                  '{"op":"write","path":"/repos/front/package.json","reason":"outside the granted folders"}'
                }
              </CodeBlock>
            </TimelineItem>
            <TimelineItem
              time="14:07:19"
              kind="throttle"
              summary={
                <>
                  rate_limit 5h at <Num value={72} suffix="%" tone="wait" /> — warning, execution
                  allowed
                </>
              }
            />
            <TimelineItem
              time="14:09:03"
              kind="text"
              summary="Updated dependencies with security patches, no breaking change."
            />
            <TimelineItem
              time="14:11:40"
              kind="run_error"
              summary="Timeout after 600s — heap out of memory at 512 invoices"
            >
              <CodeBlock label="payload run_error">
                {'{"message":"Timeout after 600s — heap out of memory at 512 invoices"}'}
              </CodeBlock>
            </TimelineItem>
            <TimelineItem
              time="14:12:01"
              kind="inbox_ask"
              summary="PDF export pagination: one page per order, or a continuous table?"
            />
            {/* Steering (v23): two rows, not one, like inbox_ask / inbox_answer. The gap between
        sending and delivery IS the information: a "you said" without its delivery never reached
        the agent. The expanded `steerId` pairs them. */}
            <TimelineItem
              time="14:12:05"
              kind="steer"
              summary="you said: change course, keep the continuous table"
            >
              <CodeBlock label="payload steer">
                {
                  '{"steerId":"K3fQz1aB9c","text":"change course, keep the continuous table","source":"human"}'
                }
              </CodeBlock>
            </TimelineItem>
            <TimelineItem
              time="14:12:06"
              kind="steer_delivered"
              summary="message delivered to the agent"
            >
              <CodeBlock label="payload steer_delivered">{'{"steerId":"K3fQz1aB9c"}'}</CodeBlock>
            </TimelineItem>
            <TimelineItem
              time="14:12:30"
              kind="repo_push"
              summary={
                <>
                  front · <Num value={7} suffix="files" tone="muted" /> · <Tag>5f0be31</Tag>
                </>
              }
            />
            <TimelineItem
              time="14:12:44"
              kind="capabilities"
              summary={
                <>
                  skills <Tag>pdf-export</Tag> · MCP <Tag>linear</Tag>
                </>
              }
            />
            <TimelineItem
              time="14:12:58"
              kind="fs_op"
              summary={
                <>
                  write <Tag>/agents/spec/spec.md</Tag>
                </>
              }
            />
            <TimelineItem time="14:13:00" kind="task_status" summary="moved to review" />
            <TimelineItem
              time="14:13:02"
              kind="result"
              summary={
                <>
                  success · <Num value="0.04" prefix="$" tone="muted" />
                </>
              }
            />
          </Timeline>
        </div>
      </Stack>
    );
  },
};

export const WaitForTaskSleepThenWake: Story = {
  name: "wait_for_task — a session goes to sleep, then wakes up on its own",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet">
        <Timeline>
          <TimelineItem
            time="09:41:02"
            kind="dependency_wait"
            summary={
              <>
                wait set on <Tag>Cart API — endpoint /checkout/quote</Tag> — I need its contract
                before wiring up the front
              </>
            }
          >
            <CodeBlock label="payload dependency_wait">
              {
                '{"inboxId":"a1B2c3D4e5","waitForTaskId":"t_9f8e7d","taskName":"Cart API — endpoint /checkout/quote","note":"I need its contract before wiring up the front"}'
              }
            </CodeBlock>
          </TimelineItem>
          <TimelineItem
            time="10:58:31"
            kind="dependency_resolved"
            summary="wait lifted — the awaited task is done"
          >
            <CodeBlock label="payload dependency_resolved">
              {'{"inboxId":"a1B2c3D4e5","waitForTaskId":"t_9f8e7d","reason":TASK_STATUS.done}'}
            </CodeBlock>
          </TimelineItem>
          <TimelineItem
            time="10:58:31"
            kind="inbox_answer"
            summary="automatic wake-up: The task you were waiting for is done. Here's its result."
          />
        </Timeline>
      </div>
    </Stack>
  ),
};

export const InertiaPauseResumesAlone: Story = {
  name: "idle pause — the session advances and resumes on its own (10/09)",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet">
        <Timeline>
          <TimelineItem
            time="03:12:07"
            kind="turn_relaunch"
            summary="automatic relaunch #3 at turn 175 — 6 commit(s), 48 write(s)"
          >
            <CodeBlock label="payload turn_relaunch">
              {
                '{"used":175,"pauseAt":175,"cap":200,"resume":3,"idleTurns":2,"sinceTurn":173,"commits":6,"writes":48,"lastCommitTurn":173,"writable":true}'
              }
            </CodeBlock>
          </TimelineItem>
        </Timeline>
      </div>
    </Stack>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "No question asked: the session used up its full turn budget, and resumes on its own in a fresh container. The collapse keeps the full measure.",
      },
    },
  },
};

export const EmphasisForcedOnOrdinaryEvent: Story = {
  name: "forced emphasis on an ordinary event",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet">
        <Timeline>
          <TimelineItem
            time="14:05:44"
            kind="fs_op"
            emphasis="security"
            summary={
              <>
                write <Tag>/agents/spec/spec.md</Tag> — outside the agent's usual scope
              </>
            }
          />
          <TimelineItem
            time="14:11:40"
            kind="status"
            emphasis="error"
            summary="session interrupted by the kill switch"
          />
        </Timeline>
      </div>
    </Stack>
  ),
};
