// Each story renders the band INSIDE a conversation sheet (`.dsc-conv-sheet`) with a thread line
// under it: the only way to see what the component settles, the border between what stays
// still and what scrolls. The first story matters most: nothing to decide, nothing on screen.
// An empty frame on top of a calm conversation would be exactly the noise this band removes.
//
// The question is the real card (D5, spec of 16/09): `InboxCard`, the one `ChannelsPage` puts
// at the end of the thread, not a facade `Panel`. The two CSS rules neutralising a `.ui-panel`
// that the application never rendered had never touched anything.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Banner } from "../ui/banner.js";
import { Button } from "../ui/button.js";
import { Stack } from "../ui/flex.js";
import { Link } from "../ui/link.js";
import { InboxCard, type CardActionRender } from "../inbox/inbox-card.js";
import { InterviewExit } from "../interviews/interview-exit.js";
import { ChannelActionBand } from "./channel-action-band.js";
import { ChannelDecision } from "./channel-decision.js";
import { question } from "./fixtures.js";
import { ScrollArea } from "../ui/scroll-area.js";
import {
  AI_2219_BODY,
  AI_2219_EVIDENCE,
  AI_2219_IMPACT,
  AI_2219_ROUND_2,
} from "../inbox/inbox-round-fixture.js";
import { CHANNELS_TEXT } from "./text.js";
import type { InboxItem as InboxQuestion } from "../api/inbox.js";
import { TASK_STATUS } from "../api/tasks.js";

const meta = { title: "channels / ChannelActionBand" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const inConversation = (band: ReactNode) => (
  <div className="dsc-conv-sheet">
    {band}
    <p className="dsc-conv-sheet-thread">
      — this is where the thread starts, and it's the one that scrolls —
    </p>
  </div>
);

/** Frozen `now`: without it "waiting for..." would drift between captures. */
const NOW = 1_756_129_260_000;

/** The card's gesture, inert: a story mounts no router. */
const cardLink: CardActionRender = (p) => <a href="#question" {...p} />;

/** The question as `ChannelsPage` puts it at the end of the thread: `InboxCard` with
 *  `hideTaskName` (the channel IS the task). */
const asked = (item: InboxQuestion, extra?: ReactNode) => (
  <Stack gap={8}>
    <InboxCard item={item} now={NOW} hideTaskName onReply={() => undefined} render={cardLink} />
    {extra}
  </Stack>
);

const CHOICES: InboxQuestion = question({
  id: "i-choice",
  kind: "choice",
  body: "The target repo has no PHP environment in this session. How do you want to proceed?",
  form: null,
  choices: [
    { id: "env", label: "Provide PHP" },
    { id: "unverified", label: "Write unverified" },
    { id: "split", label: "Break down" },
  ],
});

const FREE: InboxQuestion = question({
  id: "i-free",
  kind: "text",
  body: "I can merge the two migrations into one, or keep them separate so we can roll back step by step. Which do you want?",
  form: null,
  choices: null,
});

const noop = () => undefined;

export const NothingToDecide: Story = {
  name: "absent — nothing to decide, no empty frame",
  render: () => inConversation(<ChannelActionBand variant="thread" />),
};

export const StreamCut: Story = {
  name: "stream cut — the interruption comes before everything else",
  render: () =>
    inConversation(
      <ChannelActionBand
        variant="head"
        notice={
          <Banner
            tone="wait"
            title={CHANNELS_TEXT.stream.interrupted}
            actions={<Button size="sm">{CHANNELS_TEXT.stream.reconnect}</Button>}
          >
            {CHANNELS_TEXT.stream.interruptedWhy}
          </Banner>
        }
      />,
    ),
};

export const ChoiceQuestion: Story = {
  name: "open question, short choices — the text AND the choices, without expanding",
  render: () => inConversation(<ChannelActionBand variant="thread" pending={asked(CHOICES)} />),
};

export const FreeTextQuestion: Story = {
  name: "open question, free text only — no choices offered",
  render: () => inConversation(<ChannelActionBand variant="thread" pending={asked(FREE)} />),
};

export const FormQuestion: Story = {
  name: "open question, form — N decisions in one pause",
  render: () => inConversation(<ChannelActionBand variant="thread" pending={asked(question())} />),
};

/* The case that broke the column (07/09): a round's questionnaire is 2,500 px tall. Fixed above
   the sheet it crushed the thread; bounded and scrolling it made two scrollbars. The sheet here
   has a FIXED height like the real column, and the block sits in the sheet as the last turn:
   one scroll, and `follow` lands the view on it when opening. */
export const LongQuestionnaire: Story = {
  name: "round questionnaire — in the thread, on the last turn, a single scroll",
  render: () => (
    <div className="dsc-conv-sheet" data-tall>
      <ScrollArea size="fill" follow label="fil">
        <Stack gap={16}>
          <p className="dsc-conv-sheet-thread">
            — the thread: brief, agent turns, answered rounds —
          </p>
          <ChannelActionBand
            variant="thread"
            pending={asked(
              question({
                id: "i-round-2",
                kind: "form",
                body: AI_2219_BODY,
                evidence: AI_2219_EVIDENCE,
                impact: AI_2219_IMPACT,
                form: AI_2219_ROUND_2,
                choices: null,
              }),
            )}
          />
        </Stack>
      </ScrollArea>
    </div>
  ),
};

export const InterviewQuestion: Story = {
  name: "interview question — concluding sits NEXT TO the answer",
  render: () =>
    inConversation(
      <ChannelActionBand
        variant="thread"
        pending={asked(question(), <InterviewExit questionId="i1" />)}
      />,
    ),
};

export const GateAnnounced: Story = {
  name: "gate announced — the work hasn't been filed yet, nothing to do",
  render: () =>
    inConversation(
      <ChannelActionBand
        variant="thread"
        decision={
          <ChannelDecision
            status={TASK_STATUS.doing}
            approvalGate
            failure={null}
            busy={false}
            onApprove={noop}
            onRetry={noop}
          />
        }
      />,
    ),
};

export const GateWaiting: Story = {
  name: "gate active — the work is waiting for approval",
  render: () =>
    inConversation(
      <ChannelActionBand
        variant="thread"
        decision={
          <ChannelDecision
            status={TASK_STATUS.review}
            approvalGate
            failure={null}
            busy={false}
            onApprove={noop}
            onRetry={noop}
            prLink={<Link href="#">{CHANNELS_TEXT.decision.prDraft}</Link>}
          />
        }
      />,
    ),
};

export const FailureWithGate: Story = {
  name: "session failed, gate active — retry first, approve anyway after",
  render: () =>
    inConversation(
      <ChannelActionBand
        variant="thread"
        decision={
          <ChannelDecision
            status={TASK_STATUS.review}
            approvalGate
            busy={false}
            failure="container disappeared without reporting a result"
            onApprove={noop}
            onRetry={noop}
            taskLink={<Link href="#">{CHANNELS_TEXT.head.openTask}</Link>}
          />
        }
      />,
    ),
};

export const FailureWithoutGate: Story = {
  name: "session failed, outside review — retry, and nothing else",
  render: () =>
    inConversation(
      <ChannelActionBand
        variant="thread"
        decision={
          <ChannelDecision
            status={TASK_STATUS.doing}
            approvalGate={false}
            busy={false}
            failure="the session went over its turn cap"
            onApprove={noop}
            onRetry={noop}
          />
        }
      />,
    ),
};

export const StreamCutQuestionAndGate: Story = {
  name: "all three at once — stacked in priority order, none hidden",
  render: () =>
    inConversation(
      <ChannelActionBand
        variant="thread"
        notice={
          <Banner
            tone="wait"
            title={CHANNELS_TEXT.stream.interrupted}
            actions={<Button size="sm">{CHANNELS_TEXT.stream.reconnect}</Button>}
          >
            {CHANNELS_TEXT.stream.interruptedWhy}
          </Banner>
        }
        pending={asked(CHOICES)}
        decision={
          <ChannelDecision
            status={TASK_STATUS.doing}
            approvalGate
            failure={null}
            busy={false}
            onApprove={noop}
            onRetry={noop}
          />
        }
      />,
    ),
};
