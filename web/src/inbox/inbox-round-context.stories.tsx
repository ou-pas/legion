// The action receipt: open (ordinary question) and collapsed (multi-question round).
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../ui/flex.js";
import { InboxReceipt, InboxRoundContext } from "./inbox-round-context.js";
import { AI_2219_EVIDENCE, AI_2219_IMPACT } from "./inbox-round-fixture.js";

const meta = { title: "inbox / InboxRoundContext" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const frame = (children: React.ReactNode) => (
  <div className="dsd-sheet dsd-pad">
    <Stack gap={8}>{children}</Stack>
  </div>
);

export const Collapsed: Story = {
  name: "collapsed — a round's receipt, never expanded by default",
  render: () =>
    frame(
      <InboxRoundContext
        evidence={AI_2219_EVIDENCE}
        impact={AI_2219_IMPACT}
        agentName="interviewer"
      />,
    ),
};

export const Expanded: Story = {
  name: "expanded — what the operator sees if they open it",
  render: () =>
    frame(
      <details open className="ui-disclosure inbox-qz-ctx">
        <summary className="ui-disclosure-head">
          What the agent read, and what this round decides · 9 lines
        </summary>
        <div className="ui-disclosure-body">
          <Stack gap={8}>
            <InboxReceipt
              evidence={AI_2219_EVIDENCE}
              impact={AI_2219_IMPACT}
              agentName="interviewer"
            />
          </Stack>
        </div>
      </details>,
    ),
};

export const WithoutEvidence: Story = {
  name: "no evidence — impact alone",
  render: () =>
    frame(<InboxRoundContext evidence={null} impact={AI_2219_IMPACT} agentName="interviewer" />),
};

export const WithoutImpact: Story = {
  name: "no impact — evidence alone; without either, nothing renders",
  render: () =>
    frame(
      <>
        <InboxRoundContext evidence={AI_2219_EVIDENCE} impact={null} agentName="interviewer" />
        <InboxRoundContext evidence={null} impact={null} agentName="interviewer" />
      </>,
    ),
};

export const Open: Story = {
  name: "open — an ordinary question's receipt, as before",
  render: () =>
    frame(
      <InboxReceipt evidence={AI_2219_EVIDENCE} impact={AI_2219_IMPACT} agentName="interviewer" />,
    ),
};
