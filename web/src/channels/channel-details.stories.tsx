// What a conversation cannot carry, at the FOOT of the thread. It sat in a column until 26/08,
// then in a collapsible for an hour: the "Channel details" band cost more than the three numbers
// it hid. It is now laid out without a title; column names say what it is.
//
// The stripped story is the control: with no agent, environment, artifact or lineage, no column
// may render a bare dash; each says the right word.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChannelDetails } from "./channel-details.js";
import { Link } from "../ui/link.js";
import { AGENT, channel } from "./fixtures.js";
import type { Environment } from "../api/environments.js";
import type { Artifact, Task } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";
import { NETWORKING } from "../api/environments.js";

const meta = { title: "channels / ChannelDetails" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const ENV: Environment = {
  id: "e1",
  projectId: "p1",
  name: "workshop",
  networking: NETWORKING.limited,
  allowedHosts: [
    "github.com",
    "registry.npmjs.org",
    "api.anthropic.com",
    "esm.sh",
    "fonts.gstatic.com",
  ],
};

const ARTIFACTS: Artifact[] = [
  { name: "spec.md", size: 18_400, mimeType: "text/plain; charset=utf-8", kind: "text" },
  { name: "pr.md", size: 2_100, mimeType: "text/plain; charset=utf-8", kind: "text" },
];
const LINKS = {
  parent: {
    id: "t0",
    name: "08 · Environments screen",
    status: TASK_STATUS.done,
    agentName: "front",
    suggestedAgentName: null,
    suggestedAgentId: null,
    blocksParent: false,
  },
  children: [
    {
      id: "t2",
      name: "Backend relay: API routes",
      status: TASK_STATUS.later,
      agentName: null,
      suggestedAgentName: "server",
      suggestedAgentId: "a2",
      blocksParent: false,
    },
  ],
};

const lineage = (id: string, label: ReactNode) => (
  <Link key={id} href="#">
    {label}
  </Link>
);

export const Nominal: Story = {
  name: "nominal — cost, artifacts, lineage, grants",
  render: () => (
    <ChannelDetails
      channel={channel()}
      agent={AGENT}
      environment={ENV}
      artifacts={ARTIFACTS}
      links={LINKS}
      rounds={3}
      diffLink={<Link href="#">Diff and PR draft</Link>}
      lineageLink={lineage}
    />
  ),
};

// The case that triggered the interview of 14/09: an interview task that only produced an
// implementation plan. Without `repo_push`, neither the open button nor the diff link has a
// reason to exist: clicking could not succeed, the forge answered "No commits between main and
// legion/...". `diffLink` stays `undefined` here, exactly what `ChannelsPage` computes
// (`hasPrTab`) before building it.
const PLAN_SEUL: Artifact[] = [
  { name: "plan.md", size: 4_200, mimeType: "text/plain; charset=utf-8", kind: "text" },
];

export const WithoutPush: Story = {
  name: "interview task, nothing pushed — no button, no diff link",
  render: () => (
    <ChannelDetails
      channel={channel()}
      agent={AGENT}
      artifacts={PLAN_SEUL}
      links={{ parent: null, children: [] }}
      rounds={2}
      pushedCode={false}
    />
  ),
};

export const WithPush: Story = {
  name: "code pushed — the open button and the diff link appear",
  render: () => (
    <ChannelDetails
      channel={channel()}
      agent={AGENT}
      artifacts={ARTIFACTS}
      links={{ parent: null, children: [] }}
      rounds={4}
      pushedCode
      diffLink={<Link href="#">Diff and PR draft</Link>}
    />
  ),
};

export const Stripped: Story = {
  name: "stripped down — no artifact, no lineage, no grant",
  render: () => (
    <ChannelDetails
      channel={channel({ session: { ...channel().session!, costUsd: null } })}
      artifacts={[]}
      links={{ parent: null, children: [] }}
      rounds={0}
    />
  ),
};

export const WithoutEnvironment: Story = {
  name: "no environment — the network is named, not guessed",
  render: () => (
    <ChannelDetails
      channel={channel()}
      agent={AGENT}
      artifacts={[]}
      links={{ parent: null, children: [] }}
      rounds={1}
    />
  ),
};

/** The real titles of a split piece of work: sentences, not labels. Truncation is judged on
 *  them, and they are why it allows two lines and not one. */
const enfant = (i: number, name: string, status: Task["status"], blocksParent = false) => ({
  id: `c${i}`,
  name,
  status,
  agentName: null,
  suggestedAgentName: "server",
  suggestedAgentId: "a2",
  blocksParent,
});

const HUIT = {
  parent: LINKS.parent,
  children: [
    enfant(
      1,
      "The chantier plan doesn't account for batch 13, and cites a made-up example",
      TASK_STATUS.later,
      true,
    ),
    enfant(2, "Two tests for the same provision() invariant", TASK_STATUS.done),
    enfant(3, "The source-in-tests gate counts reads, not assertions", TASK_STATUS.later),
    enfant(4, "Store headers that claim the opposite of the code", TASK_STATUS.done),
    enfant(
      5,
      "Move logControlEvent out of shared/db.ts and remove 23 re-exports",
      TASK_STATUS.done,
    ),
    enfant(6, "Move the business rules still stuck in eleven stores", TASK_STATUS.later),
    enfant(7, "Clear the source-text assertions still left in tests", TASK_STATUS.done),
    enfant(8, "Close the boundary: the seven domains never converted", TASK_STATUS.doing),
  ],
};

export const LongLineage: Story = {
  name: "long lineage — four entries read, the rest collapsed, one prerequisite holding it back",
  render: () => (
    <ChannelDetails
      channel={channel()}
      agent={AGENT}
      environment={ENV}
      artifacts={ARTIFACTS}
      links={HUIT}
      rounds={7}
      lineageLink={lineage}
    />
  ),
};

/** The width that decides. The grid is `auto-fit minmax(190px, 1fr)`: the pane shrinks to 190px
 *  as the window narrows, and that is where truncation is proven, not at 325. */
export const NarrowLineage: Story = {
  name: "column at its minimum width — 190px, where truncation is proven",
  render: () => (
    <div className="sb-narrow-details">
      <ChannelDetails
        channel={channel()}
        agent={AGENT}
        environment={ENV}
        artifacts={ARTIFACTS}
        links={HUIT}
        rounds={7}
        lineageLink={lineage}
      />
    </div>
  ),
};
