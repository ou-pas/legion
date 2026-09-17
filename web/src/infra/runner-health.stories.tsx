// The four situations the probe produces. The third motivated the component: a declared machine
// that NEVER answered is a runner that exists in the list and will receive nothing. Without this
// sentence the operator sees one more row and wonders why the queue does not move.
//
// The fourth states the disagreement between the running inspection and the probe. It lasts a
// minute at most, and hiding it would cast doubt on the screen rather than the machine.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RunnerHealthChip, RunnerLastSeen } from "./runner-health.js";
import { Row, Stack } from "../ui/flex.js";

const meta = { title: "infra / RunnerHealth" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);

function State({ available, lastSeenAt }: { available: boolean; lastSeenAt: number | null }) {
  return (
    <Stack gap={4}>
      <Row gap={8}>
        <RunnerHealthChip available={available} />
      </Row>
      <RunnerLastSeen available={available} lastSeenAt={lastSeenAt} now={NOW} />
    </Stack>
  );
}

export const Awake: Story = {
  name: "reachable — responded 12s ago",
  render: () => <State available lastSeenAt={NOW - 12_000} />,
};

export const Asleep: Story = {
  name: "unreachable — silent for two hours",
  render: () => <State available={false} lastSeenAt={NOW - 2 * 3_600_000} />,
};

export const NeverSeen: Story = {
  name: "never probed — declared, but its daemon has never responded",
  render: () => <State available={false} lastSeenAt={null} />,
};

export const Lagging: Story = {
  name: "the probe hasn't caught up — daemon back less than 30s ago",
  render: () => <State available lastSeenAt={NOW - 90_000} />,
};

export const All: Story = {
  name: "the four in a row",
  render: () => (
    <Stack gap={16}>
      <State available lastSeenAt={NOW - 12_000} />
      <State available={false} lastSeenAt={NOW - 2 * 3_600_000} />
      <State available={false} lastSeenAt={null} />
      <State available lastSeenAt={NOW - 90_000} />
    </Stack>
  ),
};
