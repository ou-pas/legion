// The three states of the mock-up (docs/directions/direction-concierge.html), plus those it does
// not draw and that happen anyway: a brief with nothing to sort, and a refusal over an older one.
//
// The time is injected (`now`): "6 min ago" must not depend on when the story is opened.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ConciergeBrief as Brief } from "../api/concierge.js";
import { Link } from "../ui/link.js";
import { ConciergeBrief } from "./concierge-brief.js";

const meta = { title: "concierge / ConciergeBrief" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NOW = 1_700_000_000_000;

const link = (taskId: string, projectId: string | null, label: ReactNode) =>
  projectId ? <Link href={`#${projectId}/${taskId}`}>{label} →</Link> : <span>{label}</span>;

const FULL: Brief = {
  reason: "computed",
  projectCount: 2,
  generatedAt: NOW - 6 * 60_000,
  error: null,
  prose: [
    "Three sessions are running, all on **Legion**. Overnight delivered batch 08, merged at " +
      "6:12 am with green gates.",
    "The 5-hour quota is at `32%` and resets at `2:40 pm`. Nothing threatens the rest of the day.",
  ],
  items: [
    {
      severity: "now",
      text:
        "**Batch 09** has been stopped for 40 min on a write approval outside its " +
        "worktree. Nobody has seen it go by.",
      taskId: "tk09",
      projectId: "prj-legion",
    },
    {
      severity: "soon",
      text: "**PR #61** has green checks and no review since last night. It's blocking 10 and 11.",
      taskId: "tk61",
      projectId: "prj-legion",
    },
    {
      severity: "fyi",
      text:
        "**Yesterday's cost** was `$4.10`, of which `$2.80` on batch 09's probe — ten " +
        "passes for a 245-line spec.",
      taskId: null,
      projectId: null,
    },
  ],
};

export const OnWake: Story = {
  name: "on wake — three sentences, then what's waiting for a decision",
  render: () => (
    <ConciergeBrief brief={FULL} now={NOW} onRefresh={() => {}} renderTaskLink={link} />
  ),
};

export const Recomputing: Story = {
  name: "while it recomputes the report — the link locks, nothing disappears",
  render: () => (
    <ConciergeBrief brief={FULL} now={NOW} refreshing onRefresh={() => {}} renderTaskLink={link} />
  ),
};

export const NothingWaiting: Story = {
  name: "nothing is waiting for a decision — the prose stays, the list isn't invented",
  render: () => (
    <ConciergeBrief
      now={NOW}
      brief={{ ...FULL, items: [], generatedAt: NOW - 90 * 60_000, projectCount: 1 }}
      onRefresh={() => {}}
      renderTaskLink={link}
    />
  ),
};

export const LastRecomputeRefused: Story = {
  name: "the recompute failed — the previous report stays, with its age and the reason",
  render: () => (
    <ConciergeBrief
      now={NOW}
      brief={{
        ...FULL,
        generatedAt: NOW - 26 * 60 * 60_000,
        error: "the concierge couldn't respond (timed out (15s))",
      }}
      onRefresh={() => {}}
      renderTaskLink={link}
    />
  ),
};

export const UnknownProjectPlainText: Story = {
  name: "a task whose project is unknown — text, never a dead link",
  render: () => (
    <ConciergeBrief
      now={NOW}
      brief={{
        ...FULL,
        items: [
          {
            severity: "now",
            text: "**Batch 09** has been stopped for 40 min on an approval.",
            taskId: "tk09",
            projectId: null,
          },
        ],
      }}
      onRefresh={() => {}}
      renderTaskLink={link}
    />
  ),
};

export const VeryFirstRun: Story = {
  name: "very first launch — no situation report, and we say why",
  render: () => (
    <ConciergeBrief
      now={NOW}
      brief={{
        reason: "nothing-to-tell",
        prose: [],
        items: [],
        projectCount: 0,
        generatedAt: NOW,
        error: null,
      }}
      action={<Link href="#projet">Create a project</Link>}
    />
  ),
};
