// The two moments of a gate, and the case without one. What is checked here is the gap that
// motivated the component: in the "review" state there is a GESTURE, not only a description of
// the wait.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelDecision } from "./channel-decision.js";
import { Link } from "../ui/link.js";
import { CHANNELS_TEXT } from "./text.js";
import { TASK_STATUS } from "../api/tasks.js";

const meta = { title: "channels / ChannelDecision" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const prLink = <Link href="#">{CHANNELS_TEXT.decision.prDraft}</Link>;

export const InReview: Story = {
  name: "in review — the wait is there, and so is the action",
  render: () => (
    <ChannelDecision
      status={TASK_STATUS.review}
      approvalGate
      onApprove={() => undefined}
      prLink={prLink}
    />
  ),
};

export const InReviewWithoutDraft: Story = {
  name: "in review, no pr.md — approve, nothing more",
  render: () => (
    <ChannelDecision status={TASK_STATUS.review} approvalGate onApprove={() => undefined} />
  ),
};

export const Busy: Story = {
  name: "approval in progress — the button disarms",
  render: () => (
    <ChannelDecision
      status={TASK_STATUS.review}
      approvalGate
      busy
      onApprove={() => undefined}
      prLink={prLink}
    />
  ),
};

export const DeadSession: Story = {
  name: "session dead — retry, don't approve",
  render: () => (
    <ChannelDecision
      status={TASK_STATUS.review}
      approvalGate={false}
      failure="container disappeared without reporting a result"
      onApprove={() => undefined}
      onRetry={() => undefined}
      taskLink={<Link href="#">Open the task page</Link>}
    />
  ),
};

export const DeadSessionWithoutReason: Story = {
  name: "session dead with no reason — the sentence still holds",
  render: () => (
    <ChannelDecision
      status={TASK_STATUS.review}
      approvalGate={false}
      failure=""
      onApprove={() => undefined}
      onRetry={() => undefined}
    />
  ),
};

export const GateAnnounced: Story = {
  name: "gate announced — the task is still working, nothing to do",
  render: () => (
    <ChannelDecision status={TASK_STATUS.doing} approvalGate onApprove={() => undefined} />
  ),
};

export const WithoutGate: Story = {
  name: "no gate — the component renders nothing",
  render: () => (
    <div>
      <ChannelDecision
        status={TASK_STATUS.doing}
        approvalGate={false}
        onApprove={() => undefined}
      />
      <em>nothing above: a task without a gate doesn't talk about approval.</em>
    </div>
  ),
};
