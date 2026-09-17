// Pure presentation, same family as SteerField: the panel holds the typing and the displayed
// thread, the caller talks to the server. The "real" specimens are live: type a question and
// click Ask.
//
// "No write tool" is not a property of this component but a server contract (ephemeral session
// without tools, three tested safeguards). This panel only shows the question and the answer.
//
// History no longer comes from here (slice nav/10): `onAsk` only receives the message, and
// `initialTurns` renders a conversation the server read back.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ConciergeBrief as Brief } from "../api/concierge.js";
import { Link } from "../ui/link.js";
import { ConciergeBrief } from "./concierge-brief.js";
import { ConciergePanel } from "./concierge-panel.js";
import { CHAT_ROLE } from "../api/concierge.js";

const meta = { title: "concierge / ConciergePanel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const answered = () =>
  Promise.resolve(
    "**Tonight**: 3 sessions ran on the Workshop project — 2 finished, 1 failed " +
      "(`build-web`: `tsc` erroring on `concierge-panel.tsx`). Nothing is waiting on a gate.",
  );

const refused = () =>
  Promise.reject(
    new Error(
      "504 — the concierge didn't respond in time: retry, or check /control-events for detail",
    ),
  );

const pending = () => new Promise<string>(() => {}); // never resolves: the "looking..." state

const NOW = 1_700_000_000_000;

const BRIEF: Brief = {
  reason: "computed",
  projectCount: 2,
  generatedAt: NOW - 6 * 60_000,
  error: null,
  prose: ["Three sessions are running, all on **Legion**. The 5-hour quota is at `32%`."],
  items: [
    {
      severity: "now",
      text: "**Batch 09** has been stopped for 40 min on an approval.",
      taskId: "tk09",
      projectId: "prj-legion",
    },
    { severity: "fyi", text: "**Yesterday's cost** was `$4.10`.", taskId: null, projectId: null },
  ],
};

export const AtRestEmptyThread: Story = {
  name: "at rest — the thread is empty, the caption says what's read and what never is",
  render: () => <ConciergePanel onAsk={answered} />,
};

export const ReadyToAsk: Story = {
  name: "ready to ask the question (real — click Ask): the answer arrives in markdown",
  render: () => <ConciergePanel onAsk={answered} defaultText="and the cost, this week?" />,
};

export const WaitingForAnswer: Story = {
  name: 'waiting for the answer (real — click Ask): the field locks, "looking into it…"',
  render: () => <ConciergePanel onAsk={pending} defaultText="what's blocking?" />,
};

export const ServerRefusal: Story = {
  name: "server refusal (real — click Ask): the reason spelled out under the field",
  render: () => <ConciergePanel onAsk={refused} defaultText="how much did it cost this week?" />,
};

export const ResumedConversation: Story = {
  name: "a resumed conversation — the turns the server replayed are there on load",
  render: () => (
    <ConciergePanel
      onAsk={answered}
      initialTurns={[
        { role: CHAT_ROLE.user, content: "why isn't batch 09 moving forward?" },
        {
          role: CHAT_ROLE.assistant,
          content:
            "Its session is stopped on a gate: it's asking to write to `web/src/ui/`, " +
            "outside the worktree its agent is allowed to touch.\n\nThis isn't a failure. " +
            "As long as nobody answers, it waits.",
        },
        { role: CHAT_ROLE.user, content: "and the cost for the week?" },
        {
          role: CHAT_ROLE.assistant,
          content: "`$18.40` over seven days, `$11.10` of it in the last two.",
        },
      ]}
    />
  ),
};

export const BriefAsFirstTurn: Story = {
  name: "the situation report on the first turn — the page never arrives empty",
  render: () => (
    <ConciergePanel
      onAsk={answered}
      lead={
        <ConciergeBrief
          brief={BRIEF}
          now={NOW}
          onRefresh={() => {}}
          renderTaskLink={(id, projectId, label) => (
            <Link href={`#${projectId ?? "?"}/${id}`}>{label} →</Link>
          )}
        />
      }
    />
  ),
};
