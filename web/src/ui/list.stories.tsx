// Eleven ways to write "a row in a list" lived in the app. One remains: the rule, the last item
// without a rule, and density belong to the LIST, never to the caller.

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CircleCheck,
  CircleX,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Hourglass,
  Inbox,
  Play,
  Server,
  Stamp,
  type LucideIcon,
} from "lucide-react";

import { type Session } from "../api/sessions.js";
import { SESSION_CHIP } from "../sessions/session-status.js";
import { SESSION_TEXT } from "../sessions/text.js";
import { Chip, StatusChip, Tag } from "./chip.js";
import { Stack } from "./flex.js";
import { List, ListItem, ListRow } from "./list.js";
import { Num } from "./num.js";
import { SESSION_STATUS } from "../api/sessions.js";

const meta = { title: "ui / List · ListItem · ListRow" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const ICON: Record<Session["status"], LucideIcon> = {
  starting: Hourglass,
  running: Play,
  [SESSION_STATUS.waiting]: Inbox,
  blocked: Stamp,
  committing: GitCommitHorizontal,
  destroyed: CircleCheck,
  failed: CircleX,
};

type Line = {
  id: string;
  task: string;
  agent: string;
  model: string;
  cost: string;
  status: Session["status"];
};

const SESSIONS: Line[] = [
  {
    id: "s1",
    task: "Add search by order reference",
    agent: "senior-dev",
    model: "claude-sonnet-5",
    cost: "0.11",
    status: "running",
  },
  {
    id: "s2",
    task: "Spec: delivery notifications",
    agent: "spec",
    model: "claude-opus-5",
    cost: "0.96",
    status: "committing",
  },
  {
    id: "s3",
    task: "PDF export of monthly reports",
    agent: "senior-dev",
    model: "claude-sonnet-5",
    cost: "0.42",
    status: SESSION_STATUS.waiting,
  },
  {
    id: "s4",
    task: "Delete the S3 bucket of stale exports",
    agent: "senior-dev",
    model: "claude-sonnet-5",
    cost: "0.18",
    status: "blocked",
  },
  {
    id: "s5",
    task: "Bulk-generate PDF invoices",
    agent: "senior-dev",
    model: "claude-sonnet-5",
    cost: "0.35",
    status: "failed",
  },
  {
    id: "s6",
    task: "Stripe Checkout payment tunnel redesign",
    agent: "senior-dev",
    model: "claude-sonnet-5",
    cost: "2.87",
    status: "destroyed",
  },
];

function sessionLine(s: Line) {
  const Lead = ICON[s.status];
  return (
    <ListItem
      key={s.id}
      as="a"
      href="#ds-list"
      leading={<Lead size={15} />}
      title={s.task}
      sub={`${s.agent} · ${s.model.replace("claude-", "")}`}
      meta={
        <>
          <Num value={s.cost} prefix="$" tone="muted" />
          <Chip kind={SESSION_CHIP[s.status]} dot>
            {SESSION_TEXT.status[s.status]}
          </Chip>
        </>
      }
    />
  );
}

export const DensityComfortable: Story = {
  name: "comfortable density",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet">
        <List>{SESSIONS.slice(0, 4).map(sessionLine)}</List>
      </div>
    </Stack>
  ),
};

export const DensityCompact: Story = {
  name: "compact density",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet">
        <List density="compact">{SESSIONS.map(sessionLine)}</List>
      </div>
    </Stack>
  ),
};

export const SelectedDisabledLongTitle: Story = {
  name: "selected · disabled · title too long",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-sheet">
          <List>
            <ListItem
              as="a"
              href="#ds-list"
              selected
              leading={<Play size={15} />}
              title="Add search by order reference"
              sub="senior-dev · sonnet-5"
              meta={<Num value="0.11" prefix="$" tone="muted" />}
            />
            <ListItem
              disabled
              leading={<Hourglass size={15} />}
              title="Migrate the database to Postgres 17"
              sub="goal stopped — no agent can pick it up"
              meta={
                <StatusChip state="bad" dot={false}>
                  stopped
                </StatusChip>
              }
            />
            <ListItem
              as="a"
              href="#ds-list"
              leading={<CircleX size={15} />}
              title="Fix the Stripe webhook that duplicated orders during a payment replay in Belgium staging"
              sub="senior-dev · claude-sonnet-5 · branch legion/fix-stripe-webhook-duplicate-orders"
              meta={
                <>
                  <Num value="1.24" prefix="$" tone="muted" />
                  <StatusChip state="ok">done</StatusChip>
                </>
              }
            />
          </List>
        </div>
      </Stack>
    );
  },
};

export const ListRowRestMcpRules: Story = {
  name: "ListRow — repos, rules, MCP",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet">
        <List density="compact">
          <ListRow leading={<GitBranch size={14} />} meta={<Tag>legion/checkout</Tag>}>
            front<Tag>./repos/front</Tag>
          </ListRow>
          <ListRow leading={<GitBranch size={14} />} meta={<Tag>legion/tva-ue</Tag>}>
            api<Tag>./repos/api</Tag>
          </ListRow>
          <ListRow
            leading={<Server size={14} />}
            meta={
              <StatusChip state="ok" dot={false}>
                connected
              </StatusChip>
            }
          >
            linear<Tag>mcp/sse</Tag>
          </ListRow>
          <ListRow leading={<FileText size={14} />} meta={<Chip size="sm">3 agents</Chip>}>
            "stripe-payments" rule
          </ListRow>
        </List>
      </div>
    </Stack>
  ),
};

export const BodyUnderTitle: Story = {
  name: "align=start — the markers stay on the title line",
  render: () => (
    <div className="dsd-sheet">
      <List>
        <ListItem
          leading={<GitBranch size={15} />}
          title="front"
          sub="https://framagit.org/3idprint/front.git"
          meta={<Tag>GitLab</Tag>}
          actions={<StatusChip state="ok">webhook connected</StatusChip>}
        >
          yarn install --frozen-lockfile &amp;&amp; yarn build
        </ListItem>
        <ListItem
          align="start"
          leading={<GitBranch size={15} />}
          title="front"
          sub="https://framagit.org/3idprint/front.git"
          meta={<Tag>GitLab</Tag>}
          actions={<StatusChip state="ok">webhook connected</StatusChip>}
        >
          yarn install --frozen-lockfile &amp;&amp; yarn build
        </ListItem>
      </List>
    </div>
  ),
};
