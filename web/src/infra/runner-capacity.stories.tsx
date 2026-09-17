// What Docker has, compared to what it is promised. The third state motivated the component:
// three 4 GB sessions in an 8 GB Docker Desktop VM do not make 12 GB, they bring the VM down.
// That ceiling comes before ours, and it was invisible.
//
// The fourth matters as much: when Docker does not report its memory, the screen SAYS so.
// Silence here would read as a green light.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RunnerCapacity } from "./runner-capacity.js";
import { Stack } from "../ui/flex.js";

const meta = { title: "infra / RunnerCapacity" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const GB = 1024;

export const Fits: Story = {
  name: "it fits — 3 × 3 GB in 12 GB",
  render: () => (
    <RunnerCapacity maxConcurrentSessions={3} memoryMb={3 * GB} hostMemoryMb={12 * GB} />
  ),
};

export const Tight: Story = {
  name: "just barely — 3 × 4 GB in 12 GB",
  render: () => (
    <RunnerCapacity maxConcurrentSessions={3} memoryMb={4 * GB} hostMemoryMb={12 * GB} />
  ),
};

export const Over: Story = {
  name: "it overflows — 3 × 4 GB in an 8 GB VM",
  render: () => (
    <RunnerCapacity maxConcurrentSessions={3} memoryMb={4 * GB} hostMemoryMb={8 * GB} />
  ),
};

export const Unknown: Story = {
  name: "Docker didn't respond — we say so",
  render: () => <RunnerCapacity maxConcurrentSessions={3} memoryMb={4 * GB} hostMemoryMb={null} />,
};

export const All: Story = {
  name: "the four in a row",
  render: () => (
    <Stack gap={12}>
      <RunnerCapacity maxConcurrentSessions={3} memoryMb={3 * GB} hostMemoryMb={12 * GB} />
      <RunnerCapacity maxConcurrentSessions={3} memoryMb={4 * GB} hostMemoryMb={12 * GB} />
      <RunnerCapacity maxConcurrentSessions={3} memoryMb={4 * GB} hostMemoryMb={8 * GB} />
      <RunnerCapacity maxConcurrentSessions={3} memoryMb={4 * GB} hostMemoryMb={null} />
    </Stack>
  ),
};
