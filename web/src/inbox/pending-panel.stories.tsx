// The waiting panel: COMPACT on hover, FULL on demand (02/09). Hover gives the glance (counts per
// project, oldest decisions, "See all"); the expanded view shows everything grouped by project.
// Notices live in the Journal (`notices-journal.tsx`): the panel only carries what awaits a
// decision.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PendingButton, PendingPanel } from "./pending-panel.js";
import type { PendingGroup } from "./pending-entries.js";

const meta = {
  title: "inbox / Pending panel (pendingpanel)",
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// Frozen clock: an age computed from real time would render a different capture on every run.
const NOW = Date.parse("2026-08-29T12:00:00Z");
const min = (n: number) => NOW - n * 60_000;

const LEGION = { id: "prj-legion", name: "Legion" };
const KOPEE = { id: "prj-kopee", name: "Kopee.me" };

const GROUPS: PendingGroup[] = [
  {
    project: LEGION,
    entries: [
      {
        id: "q-1",
        kind: "question",
        taskId: "t-sonde",
        projectId: LEGION.id,
        since: min(8),
        text: 'The probe asks for four edges: shape of an identifier, blanks counted as "empty"…',
        meta: "Probe · 2 / 6 · 8 min",
        // v62 (07/09): a STARTED round leads to its page, and its gesture says "Resume".
        question: { projectId: LEGION.id, inboxId: "i-1" },
        action: "Resume",
      },
      {
        id: "g-1",
        kind: "gate",
        taskId: "t-decoupe",
        projectId: LEGION.id,
        since: min(2),
        text: '"Breakdown" is waiting for your approval',
        meta: "Breakdown · gate · 2 min",
        question: null,
        action: "Approve",
      },
      {
        id: "q-3",
        kind: "question",
        taskId: "t-icones",
        projectId: LEGION.id,
        since: min(41),
        text: "I can't see the attached screenshot: can you confirm which icon?",
        meta: "Standardize the icons · 41 min",
        // A TEXT question: nothing to resume, it is answered in its channel.
        question: null,
        action: "Answer",
      },
    ],
  },
  {
    project: KOPEE,
    entries: [
      {
        id: "q-2",
        kind: "question",
        taskId: "t-webhook",
        projectId: KOPEE.id,
        since: min(22),
        text: "The session died at clone: the SSH key doesn't open ansible",
        meta: "Implement the webhook · 22 min",
        question: null,
        action: "Answer",
      },
    ],
  },
];

export const Compact: Story = {
  name: 'compact (hover) — counts per project, the 3 oldest, "See all"',
  render: () => <PendingPanel groups={GROUPS} />,
};

export const CompactOneProject: Story = {
  name: "compact, a single project — no count row, the entries are enough",
  render: () => <PendingPanel groups={GROUPS.slice(1)} />,
};

export const Full: Story = {
  name: 'full (after "See all") — everything, grouped by project',
  render: () => <PendingPanel groups={GROUPS} defaultExpanded />,
};

export const Empty: Story = {
  name: "nothing is stalled — the panel says so instead of a silent void",
  render: () => <PendingPanel groups={[]} />,
};

export const Clickable: Story = {
  name: "entries lead to their task",
  render: () => (
    <PendingPanel
      groups={GROUPS}
      render={(entry, props) => <a href={`/tasks/${entry.taskId}`} {...props} />}
    />
  ),
};

export const Button: Story = {
  name: "the bar's button — four waiting (pulsing pill)",
  render: () => (
    <PendingButton count={4}>
      <PendingPanel groups={GROUPS} />
    </PendingButton>
  ),
};

export const ButtonZero: Story = {
  name: "the button at zero — pill off, muted",
  render: () => (
    <PendingButton count={0}>
      <PendingPanel groups={[]} />
    </PendingButton>
  ),
};
