// THE thread, the one both surfaces render. This is where the D9ter condition is checked: the
// channel and the Interview tab show the same object. The states covered are those changing the
// thread itself: pinned brief, cut-stream alert, open question, decision, and both heights
// (`fill` for a window-height page, `lg` for a tab panel).
//
// Since 04/09 the last three are no longer inside the scrolling pane but fixed above it, hence
// the `.dsc-conv-sheet` sheet: outside a conversation pane that border would not show.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Panel } from "../ui/panel.js";
import { ChannelDecision } from "./channel-decision.js";
import { ChannelThread } from "./channel-thread.js";
import { BRIEF, BRIEF_AT, FLUX, QUESTION } from "./fixtures.js";
import { CHANNELS_TEXT } from "./text.js";
import { transcript } from "./transcript.js";
import { TASK_STATUS } from "../api/tasks.js";

const meta = { title: "channels / ChannelThread" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const segments = transcript(FLUX);

export const FullThread: Story = {
  name: "complete — the question is fixed at the top, the thread scrolls below",
  render: () => (
    <div className="dsc-conv-sheet">
      <ChannelThread
        size="lg"
        brief={BRIEF}
        briefAuthor="Operator"
        briefAt={BRIEF_AT}
        segments={segments}
        agentName="interviewer"
        operatorName="Operator"
        pending={{
          inboxId: "i1",
          node: (
            <Panel>
              <p>{QUESTION.body}</p>
            </Panel>
          ),
        }}
        footer={
          <ChannelDecision
            status={TASK_STATUS.doing}
            approvalGate
            failure={null}
            busy={false}
            onApprove={() => undefined}
            onRetry={() => undefined}
          />
        }
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "The thread's `i1` round no longer repeats the question: it refers to the band. One question, one place to answer it.",
      },
    },
  },
};

export const StreamCut: Story = {
  name: "stream cut — the alert is in the band, it doesn't belong to the thread",
  render: () => (
    <div className="dsc-conv-sheet">
      <ChannelThread
        size="lg"
        brief={BRIEF}
        briefAuthor="Operator"
        briefAt={BRIEF_AT}
        segments={segments}
        agentName="interviewer"
        operatorName="Operator"
        notice={
          <Banner
            tone="wait"
            title={CHANNELS_TEXT.stream.interrupted}
            actions={<Button size="sm">{CHANNELS_TEXT.stream.reconnect}</Button>}
          >
            {CHANNELS_TEXT.stream.interruptedWhy}
          </Banner>
        }
      />
    </div>
  ),
};

export const WithoutBand: Story = {
  name: "no band — nothing is waiting, the thread starts under the header with no empty frame",
  render: () => (
    <div className="dsc-conv-sheet">
      <ChannelThread
        size="lg"
        brief={BRIEF}
        briefAuthor="Operator"
        briefAt={BRIEF_AT}
        segments={segments}
        agentName="interviewer"
        operatorName="Operator"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'This is also how the task page\'s "Interview" tab renders: it lives above the tabs, so it passes neither `notice`, nor `pending`, nor `footer`.',
      },
    },
  },
};

export const EmptyBriefNothingSaid: Story = {
  name: "empty brief, silent session — two absences stated, never a blank",
  render: () => (
    <div className="dsc-conv-sheet">
      <ChannelThread
        size="lg"
        brief=""
        briefAuthor="Operator"
        briefAt={BRIEF_AT}
        segments={[]}
        agentName="interviewer"
        operatorName="Operator"
      />
    </div>
  ),
};
