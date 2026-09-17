// What surrounded a past question. The story that justifies the module is the first: three
// choices, one kept. Without the other two, a trade-off reads as obvious.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InboxHistoryEntry } from "../api/inbox.js";
import { Stack } from "../ui/flex.js";
import { ChannelRound } from "./channel-round.js";
import { ChannelRoundArchive } from "./channel-round-archive.js";

const meta = { title: "channels / ChannelRoundArchive" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const T = new Date("2026-08-24T10:30:00Z").getTime();

const entry = (over: Partial<InboxHistoryEntry>): InboxHistoryEntry => ({
  id: "q1",
  sessionId: "s-1",
  kind: "choice",
  body: "Should we keep the Interview tab in addition to the channel?",
  evidence: null,
  impact: null,
  choices: null,
  form: null,
  status: "answered",
  onAnswer: "resume",
  agentName: "senior-dev",
  waitForTaskId: null,
  waitForTaskName: null,
  waitForTaskStatus: null,
  wakeAt: null,
  createdAt: T,
  answer: {
    answeredBy: "human",
    answeredAt: T + 4 * 60_000,
    selectedChoiceId: "keep",
    text: "Keep both",
    formData: null,
  },
  ...over,
});

const CHOICES = [
  { id: "keep", label: "Keep both" },
  { id: "tab", label: "Remove the channel" },
  { id: "channel", label: "Remove the tab" },
];

export const ThreeChoicesOneKept: Story = {
  name: "three choices, one kept — the discarded ones stay readable",
  render: () => <ChannelRoundArchive entry={entry({ choices: CHOICES })} />,
};

export const WithReceipt: Story = {
  name: "with the receipt — what the agent had read, what it touched",
  render: () => (
    <ChannelRoundArchive
      entry={entry({
        choices: CHOICES,
        evidence: "docs/directions/direction-canaux.html §4, and the week's 3 interviews.",
        impact: "web/src/channels/ and the Interview tab of the Task page.",
      })}
    />
  ),
};

export const Diagnostic: Story = {
  name: "a diagnostic question — answering it retried the task",
  render: () => (
    <ChannelRoundArchive
      entry={entry({
        onAnswer: "retry-task",
        body: "The session stopped on a red lint. Retry?",
        choices: [
          { id: "retry", label: "Retry" },
          { id: "leave", label: "Leave in review" },
        ],
        answer: {
          answeredBy: "human",
          answeredAt: T,
          selectedChoiceId: "retry",
          text: "Retry",
          formData: null,
        },
      })}
    />
  ),
};

export const NothingToShow: Story = {
  tags: ["renders-nothing"], // deliberately empty: see stories.test.tsx
  name: "a free-text question, no receipt — the module renders nothing",
  render: () => <ChannelRoundArchive entry={entry({ kind: "text" })} />,
};

export const InTheRound: Story = {
  name: "inside the collapsed round — what you see when you expand it",
  render: () => (
    <Stack gap={12}>
      <ChannelRound
        question="Should we keep the Interview tab in addition to the channel?"
        answer="Keep both"
        answeredTime="10:34"
        archive={entry({
          choices: CHOICES,
          evidence: "docs/directions/direction-canaux.html §4, and the week's 3 interviews.",
          impact: "web/src/channels/ and the Interview tab of the Task page.",
        })}
      />
    </Stack>
  ),
};
