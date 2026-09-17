// What will go out at run time, and where it comes from. The row informs without forbidding: at a
// glance it must say whether what shows comes from the classifier, a fallback because it failed,
// or an operator choice, and when mixed, WHICH is which. The four provenances differ only by
// discreet marks, and this is where one checks they still do.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskProposal } from "./task-proposal.js";

const meta = { title: "tasks / TaskProposal" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NO_PIN = { target: false, complexity: false, gate: false };

export const Analysing: Story = {
  name: "analysis in progress — the title just changed",
  render: () => (
    <TaskProposal
      pending
      manual={false}
      kind="agent"
      name="builder"
      complexity="med"
      gate={false}
    />
  ),
};

export const Proposed: Story = {
  name: "proposed — an agent, a complexity, a gate, and the why",
  render: () => (
    <TaskProposal
      pending={false}
      manual={false}
      kind="agent"
      name="builder"
      complexity="med"
      gate={false}
      pinned={NO_PIN}
      reason="a screen to write in an already broken-down domain"
    />
  ),
};

export const ProposedWithGate: Story = {
  name: "proposed with gate — the classifier asks for a review",
  render: () => (
    <TaskProposal
      pending={false}
      manual={false}
      kind="agent"
      name="builder"
      complexity="high"
      gate
      pinned={NO_PIN}
      reason="touches authentication and secret encryption"
    />
  ),
};

export const AChain: Story = {
  name: "a proposed chain — neither complexity nor gate, they mean nothing here",
  render: () => (
    <TaskProposal
      pending={false}
      manual={false}
      kind="chain"
      name="Spec → Build → Verify"
      complexity="med"
      gate={false}
      pinned={NO_PIN}
      reason="a broad request, with no written scope"
    />
  ),
};

export const Fallback: Story = {
  name: "fallback — the classifier didn't complete, and the row SAYS so",
  render: () => (
    <TaskProposal
      pending={false}
      manual={false}
      kind="agent"
      name="builder"
      complexity="med"
      gate={false}
      pinned={NO_PIN}
      reason="fallback"
    />
  ),
};

export const OnePin: Story = {
  name: "one pin — the rest is proposed AROUND the operator's choice",
  render: () => (
    <TaskProposal
      pending={false}
      manual={false}
      kind="agent"
      name="reviewer"
      complexity="high"
      gate={false}
      pinned={{ ...NO_PIN, target: true }}
      reason="the agent is fixed; the complexity follows the announced diff size"
    />
  ),
};

export const AllPinned: Story = {
  name: "everything pinned — nothing is proposed anymore, and no call goes out",
  render: () => (
    <TaskProposal
      pending={false}
      manual
      kind="agent"
      name="reviewer"
      complexity="low"
      gate
      pinned={{ target: true, complexity: true, gate: true }}
      reason={null}
    />
  ),
};

export const AnalysingWithPin: Story = {
  name: "analysis in progress while a pin is set — the wait stays readable",
  render: () => (
    <TaskProposal
      pending
      manual={false}
      kind="agent"
      name="builder"
      complexity="med"
      gate={false}
      pinned={{ ...NO_PIN, gate: true }}
    />
  ),
};
