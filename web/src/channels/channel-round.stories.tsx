// The three faces of a round: waiting in place, waiting but PROMOTED to the action band (a
// pointer line, not a second place to answer), and ANSWERED (collapsed on its own, answers
// summarised). The last carries the 25/08 decision: rereading a three-round interview must not
// take two screens.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelRound } from "./channel-round.js";
import { Stack } from "../ui/flex.js";

const meta = { title: "channels / ChannelRound" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const Q =
  "Three decisions before writing the spec: what survives a pause, the package cache, the interview agent's name.";

/** The JSON the control plane stores in `inbox_answer` for a form. */
const FORM_ANSWER = JSON.stringify({
  survive: "a /workspace volume per session",
  survive__note: "I wanted to keep the container; fine with the volume if q2 follows",
  cache: true,
  name: "interviewer",
});

export const Waiting: Story = {
  name: "waiting, not promoted — the panel carries the question, without its form",
  render: () => (
    <div className="dsc-conv">
      <ChannelRound question={Q} answer={null} />
    </div>
  ),
};

export const Promoted: Story = {
  name: "promoted — the question moved up to the band, the thread only keeps its trace",
  render: () => (
    <div className="dsc-conv">
      <ChannelRound question={Q} answer={null} promoted />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "One question, one place to answer it. The chronological spot stays marked — without it, the thread would jump from one message to the next without saying a question happened there.",
      },
    },
  },
};

export const PromotedAnswered: Story = {
  name: "promoted but answered — `promoted` changes nothing for a closed round",
  render: () => (
    <div className="dsc-conv">
      <ChannelRound question={Q} answer={FORM_ANSWER} answeredTime="13:02" promoted />
    </div>
  ),
};

export const AnsweredForm: Story = {
  name: "answered — collapsed, answers and comment summarized",
  render: () => (
    <div className="dsc-conv">
      <Stack gap={10}>
        <ChannelRound question={Q} answer={FORM_ANSWER} answeredTime="13:02" />
      </Stack>
    </div>
  ),
};

export const AnsweredFreeText: Story = {
  name: "answered — one sentence, not a form",
  render: () => (
    <div className="dsc-conv">
      <ChannelRound
        question="Do we also notify by SMS, or email only for v1?"
        answer="email only, SMS can wait for a real need"
        answeredTime="13:20"
      />
    </div>
  ),
};
