// The list of LIVE channels. The empty state has its story for one reason: a story starting on a
// value hides the empty case, which is exactly what let a radio defect through on 25/08. "No
// live channel" must read as good news, not as an outage.
import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelList } from "./channel-list.js";
import { QUESTION, channel, question } from "./fixtures.js";
import { Link } from "../ui/link.js";

const meta = { title: "channels / ChannelList" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const BOARD = <Link href="#">see on the board</Link>;

const FULL = [
  channel({
    name: "spec out discussion mode",
    state: "waiting",
    question: QUESTION,
    gate: false,
  }),
  channel({ name: "settings screen 09", state: "waiting", gate: true }),
  channel({ name: "backend relay environments", state: "running", gate: false }),
  channel({ name: "hatching audit", state: "idle", gate: false }),
];

/** The case seen on 04/09: four unrelated agents ask the SAME question. */
const BUDGET_QUESTION = question({ body: "Budget reached, should I continue?" });
const GROUPED = [
  channel({
    name: "AI-2194 — red test for auth credentials",
    state: "waiting",
    question: QUESTION,
    gate: false,
  }),
  channel({
    name: "AI-2201 — migrate Stripe webhooks",
    state: "waiting",
    question: BUDGET_QUESTION,
    gate: false,
  }),
  channel({
    name: "AI-2202 — Postgres index cleanup",
    state: "waiting",
    question: BUDGET_QUESTION,
    gate: false,
  }),
  channel({
    name: "AI-2203 — weekly Concierge report",
    state: "waiting",
    question: BUDGET_QUESTION,
    gate: false,
  }),
  channel({
    name: "AI-2205 — Select component redesign",
    state: "waiting",
    question: BUDGET_QUESTION,
    gate: false,
  }),
];

/** The list is a COLUMN of the page, shown at its real width. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="dsc-rail">{children}</div>;
}

export const ThreeSections: Story = {
  name: "three sections — waiting for you, running, on hold",
  render: function Render() {
    const [picked, setPicked] = useState(FULL[0]!.task.id);
    return (
      <Frame>
        <ChannelList
          channels={FULL}
          selectedId={picked}
          onSelect={setPicked}
          closedToday={4}
          later={14}
          boardLink={BOARD}
        />
      </Frame>
    );
  },
};

export const SameQuestionGroup: Story = {
  name: '"waiting for you" — four channels ask the same question',
  render: function Render() {
    const [picked, setPicked] = useState(GROUPED[0]!.task.id);
    return (
      <Frame>
        <ChannelList
          channels={GROUPED}
          selectedId={picked}
          onSelect={setPicked}
          closedToday={0}
          later={0}
          boardLink={BOARD}
        />
      </Frame>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Each channel shows an excerpt of its question. The four asking "budget reached, should I continue?" group under "4 alike"; AI-2194\'s stays alone.',
      },
    },
  },
};

export const LongExcerptTruncated: Story = {
  name: "long question excerpt — truncated to one line",
  render: function Render() {
    const long = channel({
      name: "AI-2194 — red test: the auth credentials failure must surface FailedResponseException",
      state: "waiting",
      gate: false,
      question: question({
        body: "The target repo has no PHP environment able to run pest/phpunit in this session. How do you want to proceed?",
      }),
    });
    return (
      <Frame>
        <ChannelList
          channels={[long]}
          selectedId={long.task.id}
          onSelect={() => {}}
          closedToday={0}
          later={0}
          boardLink={BOARD}
        />
      </Frame>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "The task title AND its question excerpt are each truncated by CSS (ellipsis), never in JS.",
      },
    },
  },
};

export const OnlyInProgress: Story = {
  name: 'only "running" — nothing is waiting for you',
  render: function Render() {
    const only = FULL.filter((c) => c.state === "running");
    return (
      <Frame>
        <ChannelList
          channels={only}
          selectedId={only[0]!.task.id}
          onSelect={() => {}}
          closedToday={0}
          later={14}
          boardLink={BOARD}
        />
      </Frame>
    );
  },
};

export const EmptyWithBacklog: Story = {
  name: "empty — no live channel, backlog behind it",
  render: function Render() {
    return (
      <Frame>
        <ChannelList
          channels={[]}
          selectedId={null}
          onSelect={() => {}}
          closedToday={4}
          later={14}
          boardLink={BOARD}
        />
      </Frame>
    );
  },
};

export const EntirelyEmpty: Story = {
  name: "empty — first day of the project, nothing anywhere",
  render: function Render() {
    return (
      <Frame>
        <ChannelList
          channels={[]}
          selectedId={null}
          onSelect={() => {}}
          closedToday={0}
          later={0}
          boardLink={BOARD}
        />
      </Frame>
    );
  },
};
