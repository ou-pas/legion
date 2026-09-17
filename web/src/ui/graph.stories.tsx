// A goal's real plan: the column is depth, stacking is parallelism. Hover a step: its upstream and
// downstream dependencies stay sharp, the rest fades. The critical path is thicker.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./flex.js";
import { Graph, type GraphEdge, type GraphNode } from "./graph.js";

const meta = { title: "ui / Graph" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// The states are the GRAPH's, not task statuses: the caller translates (05/09).
const NODES: GraphNode[] = [
  { id: "audit", label: "Audit the payment flow", agent: "spec", state: "done" },
  { id: "webhook", label: "Make the webhook idempotent", agent: "senior-dev", state: "done" },
  { id: "checkout", label: "Migrate to hosted Checkout", agent: "senior-dev", state: "doing" },
  { id: "review", label: "Consolidated review", agent: "review-coordinator", state: "todo" },
];

const EDGES: GraphEdge[] = [
  { from: "audit", to: "webhook" },
  { from: "audit", to: "checkout", critical: true },
  { from: "webhook", to: "review" },
  { from: "checkout", to: "review", critical: true },
];

export const FourStepsTwoParallelCriticalPath: Story = {
  name: "4 steps, 2 in parallel, critical path marked",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet dsd-pad">
        <Graph nodes={NODES} edges={EDGES} label="Plan for the Harden the payment tunnel goal" />
      </div>
    </Stack>
  ),
};

export const LinearChain: Story = {
  name: 'linear chain — goal "Cut front build time"',
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet dsd-pad">
        <Graph
          label="Plan for the Cut front build time goal"
          nodes={[
            { id: "audit", label: "Measure the CI build", agent: "senior-dev", state: "done" },
            {
              id: "deps",
              label: "Purge unused dependencies",
              agent: "senior-dev",
              state: "done",
            },
            {
              id: "check",
              label: "Verify under 90s",
              agent: "review-coordinator",
              state: "done",
            },
          ]}
          edges={[
            { from: "audit", to: "deps", critical: true },
            { from: "deps", to: "check", critical: true },
          ]}
        />
      </div>
    </Stack>
  ),
};
