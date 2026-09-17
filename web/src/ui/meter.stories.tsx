// Meter measures an OCCUPANCY (higher is worse: warns above 75 %, alarms above 90 %). ProgressBar
// measures PROGRESS and turns green once full.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseDiff } from "react-diff-view";

import { InboxForm } from "../inbox/inbox-form.js";
import { DiffFile } from "../review/diff-file.js";
import { DiffTree } from "../review/diff-tree.js";
import { buildFileTree } from "../review/file-tree.js";
import { TaskProposal } from "../tasks/task-proposal.js";
import { Stack } from "./flex.js";
import { Meter, ProgressBar } from "./meter.js";
import { Num } from "./num.js";

const meta = { title: "ui / Meter · ProgressBar" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** A real patch parsed by the library: the gallery shows the REAL rendering, not an imitation. */
const DS_TREE = buildFileTree([
  {
    repo: "legion",
    path: "web/src/review/diff-view.tsx",
    additions: 42,
    deletions: 12,
    comments: 2,
  },
  {
    repo: "legion",
    path: "web/src/review/diff-tree.tsx",
    additions: 88,
    deletions: 0,
    comments: 0,
  },
  { repo: "legion", path: "web/src/ui/split.css", additions: 9, deletions: 1, comments: 0 },
  {
    repo: "legion",
    path: "server/src/review/review.ts",
    additions: 31,
    deletions: 7,
    comments: 1,
  },
  { repo: "legion", path: "README.md", additions: 2, deletions: 2, comments: 0 },
]);

const DS_HUNKS =
  parseDiff(
    "diff --git a/src/report.tsx b/src/report.tsx\n--- a/src/report.tsx\n+++ b/src/report.tsx\n" +
      "@@ -10,4 +10,6 @@ export function Report() {\n   const data = useReport();\n" +
      "-  return <div>{data.total}</div>;\n+  if (!data) return <Spinner />;\n" +
      "+  // the total is rounded server-side\n+  return <div>{data.total}</div>;\n   }\n",
  )[0]?.hunks ?? [];

export const BelowThreshold: Story = {
  name: "below the threshold",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-half dsd-stack">
        <Meter
          name='Duration for the "Harden the payment tunnel" goal'
          value={72}
          valueText="72% of the max duration elapsed"
          valueLabel={<Num value={72} suffix="%" />}
        />
        <Meter
          name='Budget for the "Harden the payment tunnel" goal'
          value={6.42}
          max={25}
          valueLabel={
            <>
              <Num value="6.42" prefix="$" /> / <Num value="25.00" prefix="$" />
            </>
          }
        />
      </div>
    </Stack>
  ),
};

export const Alert75AndMaximum: Story = {
  name: "in alert (≥ 75%) and at maximum",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-half dsd-stack">
        <Meter
          name='Duration for the "Migrate the database to Postgres 17" goal'
          value={88}
          valueLabel={<Num value={88} suffix="%" />}
        />
        <Meter
          name='Budget for the "Migrate the database to Postgres 17" goal'
          value={25}
          max={25}
          valueLabel={
            <>
              <Num value="25.00" prefix="$" /> / <Num value="25.00" prefix="$" />
            </>
          }
        />
      </div>
    </Stack>
  ),
};

export const ProgressBarGoalDoD: Story = {
  name: "ProgressBar — a goal's DoD",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-half dsd-stack">
        <ProgressBar
          name="DoD — Harden the payment tunnel"
          value={2}
          max={4}
          size="lg"
          valueLabel={<Num value="2 / 4" />}
          valueText="2 of 4 criteria met"
        />
        <ProgressBar
          name="DoD — Cut front build time"
          value={2}
          max={2}
          size="lg"
          valueLabel={<Num value="2 / 2" />}
          valueText="2 of 2 criteria met"
        />
      </div>
    </Stack>
  ),
};

export const BareGaugeInRail: Story = {
  name: "bare — the gauge alone, in a rail",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-narrow">
        <Meter name='Fill level of the "Doing" column' value={72} size="sm" bare />
      </div>
    </Stack>
  ),
};

export const TaskProposalStates: Story = {
  name: "TaskProposal — analyzing / proposed / fallback / manual",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-stack">
          <TaskProposal
            pending
            manual={false}
            kind="agent"
            name="server"
            complexity="med"
            gate={false}
          />
          <TaskProposal
            pending={false}
            manual={false}
            kind="agent"
            name="server"
            complexity="high"
            gate
            reason="The brief touches runner/manager.ts and a migration: server agent's scope, complex, cautious gate on a migration."
          />
          <TaskProposal
            pending={false}
            manual={false}
            kind="chain"
            name="compound-engineer"
            complexity="med"
            gate={false}
            reason="fallback"
          />
          <TaskProposal
            pending={false}
            manual={false}
            kind="agent"
            name="server"
            complexity="med"
            gate
            pinned={{ target: true, complexity: false, gate: false }}
            reason="Agent forced by the operator; the brief touches a migration, cautious gate, normal complexity."
          />
          <TaskProposal
            pending={false}
            manual
            kind="agent"
            name="front"
            complexity="low"
            gate={false}
            pinned={{ target: true, complexity: true, gate: true }}
          />
        </div>
      </Stack>
    );
  },
};

export const DiffTreeCompactedFolders: Story = {
  name: "DiffTree — collapsed folders, counts, comments, current file",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-narrow">
          <DiffTree
            nodes={DS_TREE}
            openDirs={new Set(["web/src/review", "web/src/ui"])}
            current="legion/web/src/review/diff-view.tsx"
            onToggleDir={() => {}}
            onPick={() => {}}
          />
        </div>
      </Stack>
    );
  },
};

export const DiffFileCommentStates: Story = {
  name: "DiffFile — simple comment, range, sent, patch omitted",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-stack">
        <DiffFile
          repo="front"
          path="src/report.tsx"
          status="modified"
          additions={3}
          deletions={1}
          hunks={DS_HUNKS}
          comments={[
            {
              id: "rc1",
              taskId: "t",
              repoName: "front",
              filePath: "src/report.tsx",
              line: 11,
              side: "new",
              startLine: null,
              excerpt: "if (!data) return <Spinner />;",
              body: "The spinner must carry a label — DS accessibility rule.",
              status: "open",
              createdAt: "",
              sentAt: null,
            },
            {
              id: "rc2",
              taskId: "t",
              repoName: "front",
              filePath: "src/report.tsx",
              line: 13,
              side: "new",
              startLine: 12,
              excerpt: "// the total is rounded server-side",
              body: 'These two lines: the comment says "rounded" but the function truncates.\nNeeds a fix or a rewording.',
              status: "sent",
              createdAt: "",
              sentAt: "",
            },
          ]}
          selection={null}
          open
          onOpenChange={() => {}}
          onLineClick={() => {}}
          onDelete={() => {}}
        />
        <DiffFile
          repo="front"
          path="assets/logo.png"
          status="added"
          additions={0}
          deletions={0}
          hunks={null}
          comments={[]}
          selection={null}
          open
          onOpenChange={() => {}}
          onLineClick={() => {}}
          onDelete={() => {}}
        />
      </div>
    </Stack>
  ),
};

export const InboxFormFull: Story = {
  name: "InboxForm — full (markdown + SVG + fields) / sending / SVG refused",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-stack">
        <InboxForm
          pending={false}
          onSubmit={() => {}}
          spec={{
            blocks: [
              {
                kind: "markdown",
                text: "Two possible strategies for the **secrets migration**. The diagram shows where each option cuts the flow:",
              },
              {
                kind: "svg",
                caption: "Option A cuts at the proxy, option B at the runner",
                svg: '<svg viewBox="0 0 420 90" role="img"><rect x="6" y="30" width="90" height="30" rx="3" fill="none" stroke="currentColor"/><text x="51" y="49" text-anchor="middle" font-size="12" fill="currentColor">control plane</text><line x1="96" y1="45" x2="160" y2="45" stroke="currentColor"/><rect x="160" y="30" width="80" height="30" rx="3" fill="none" stroke="currentColor"/><text x="200" y="49" text-anchor="middle" font-size="12" fill="currentColor">proxy</text><line x1="240" y1="45" x2="304" y2="45" stroke="currentColor"/><rect x="304" y="30" width="80" height="30" rx="3" fill="none" stroke="currentColor"/><text x="344" y="49" text-anchor="middle" font-size="12" fill="currentColor">runner</text><text x="128" y="20" text-anchor="middle" font-size="11" fill="currentColor">A</text><text x="272" y="20" text-anchor="middle" font-size="11" fill="currentColor">B</text><line x1="128" y1="26" x2="128" y2="64" stroke="currentColor" stroke-dasharray="3 3"/><line x1="272" y1="26" x2="272" y2="64" stroke="currentColor" stroke-dasharray="3 3"/></svg>',
              },
              {
                kind: "field",
                field: {
                  id: "strategy",
                  label: "Cutover strategy",
                  type: "radio",
                  required: true,
                  options: [
                    { id: "proxy", label: "A — at the proxy (reversible)" },
                    { id: "runner", label: "B — at the runner (final)" },
                  ],
                },
              },
              {
                kind: "field",
                field: {
                  id: "window",
                  label: "Migration window",
                  type: "select",
                  required: true,
                  options: [
                    { id: "now", label: "now" },
                    { id: "night", label: "tonight" },
                    { id: "weekend", label: "weekend" },
                  ],
                },
              },
              {
                kind: "field",
                field: {
                  id: "budget",
                  label: "Downtime budget (minutes)",
                  type: "number",
                  min: 0,
                  max: 120,
                  hint: "0 = no downtime tolerated",
                },
              },
              {
                kind: "field",
                field: {
                  id: "dryrun",
                  label: "Do a dry run on the demo project first",
                  type: "checkbox",
                },
              },
              {
                kind: "field",
                field: {
                  id: "notes",
                  label: "Additional instructions",
                  type: "textarea",
                  placeholder: "Optional…",
                },
              },
            ],
          }}
        />
        <InboxForm
          pending
          onSubmit={() => {}}
          spec={{
            blocks: [
              {
                kind: "markdown",
                text: "Sending — the button disables during the mutation.",
              },
              { kind: "field", field: { id: "ok", label: "Confirm", type: "checkbox" } },
            ],
          }}
        />
        <InboxForm
          pending={false}
          onSubmit={() => {}}
          spec={{
            blocks: [
              {
                kind: "markdown",
                text: "An unrecoverable SVG doesn't leave a hole: the state is SAID.",
              },
              { kind: "svg", svg: "<div><script>alert(1)</script></div>" },
              {
                kind: "field",
                field: { id: "go", label: "Continue anyway", type: "checkbox" },
              },
            ],
          }}
        />
      </div>
    </Stack>
  ),
};
