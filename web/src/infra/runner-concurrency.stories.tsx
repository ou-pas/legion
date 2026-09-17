// A runner's ceiling of simultaneous sessions. The third state motivated the component: when the
// load exceeds the ceiling (just lowered), the screen must say what will NOT happen. Nobody kills
// a container; the queue just stops starting.
// The field carries its own label since the dense sheet (02/09): the story places it bare, like
// the sheet's Settings drawer; a KeyValue on top would double the label.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RunnerConcurrency } from "./RunnerConcurrency.js";
import { Stack } from "../ui/flex.js";

const meta = { title: "infra / RunnerConcurrency" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function InCard({ value, running }: { value: number; running: number }) {
  return (
    <div className="dsd-narrow">
      <RunnerConcurrency runnerId="r1" runnerName="local" value={value} running={running} />
    </div>
  );
}

export const Idle: Story = {
  name: "at rest — no slot taken",
  render: () => <InCard value={3} running={0} />,
};

export const Loaded: Story = {
  name: "under load — 2 of 6 slots",
  render: () => <InCard value={6} running={2} />,
};

export const Full: Story = {
  name: "full — the queue waits",
  render: () => <InCard value={3} running={3} />,
};

export const AboveCeiling: Story = {
  name: "load above the ceiling (just lowered)",
  render: () => <InCard value={1} running={4} />,
};

export const InPanel: Story = {
  name: "the four side by side",
  render: () => (
    <Stack gap={16}>
      <InCard value={3} running={0} />
      <InCard value={6} running={2} />
      <InCard value={3} running={3} />
      <InCard value={1} running={4} />
    </Stack>
  ),
};
