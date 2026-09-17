// A session's RAM and CPUs. The historical default (1 GB) sits next to a workable setting,
// because that comparison explains the batch: in 1 GB a front-end agent cannot run Storybook and
// drive a Chrome, which `CLAUDE.md` asks of it on every task.
//
// The fields carry their own labels since the dense sheet (02/09): the story places them bare,
// like the sheet's Settings drawer. Two exports since 02/09: the sheet composes CpusField and
// MemoryField in its own grid (steppers share a row, RAM spans), and the story reproduces that.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "../ui/flex.js";
import { CpusField, MemoryField } from "./RunnerResources.js";

const meta = { title: "infra / RunnerResources" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function InCard({
  memoryMb,
  cpus,
  name = "local",
}: {
  memoryMb: number;
  cpus: number;
  name?: string;
}) {
  return (
    <div className="dsd-narrow">
      <Stack gap={16}>
        <CpusField runnerId="r1" runnerName={name} value={cpus} />
        <MemoryField runnerId="r1" runnerName={name} value={memoryMb} />
      </Stack>
    </div>
  );
}

export const Legacy: Story = {
  name: "the historical default — 1 GB, 1 CPU",
  render: () => <InCard memoryMb={1024} cpus={1} />,
};

export const Workable: Story = {
  name: "workable for a front-end agent — 3 GB, 2 CPU",
  render: () => <InCard memoryMb={3072} cpus={2} />,
};

export const HomeServer: Story = {
  name: "the home server, which has room",
  render: () => <InCard memoryMb={6144} cpus={4} name="home-server" />,
};

export const Fractional: Story = {
  name: "a fraction of a core",
  render: () => <InCard memoryMb={2048} cpus={0.5} />,
};
