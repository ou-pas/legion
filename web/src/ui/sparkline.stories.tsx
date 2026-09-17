// A recent trend in one stroke. No axis, no legend: meaning comes from where it is placed (see
// `infra/runner-metrics.tsx`).
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row, Stack } from "./flex.js";
import { Sparkline, type SparklinePoint } from "./sparkline.js";
import { Text } from "./text.js";

const meta = { title: "ui / Sparkline" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const wave = (base: number, amp: number, n = 20): SparklinePoint[] =>
  Array.from({ length: n }, (_, i) => ({
    at: i * 30_000,
    value: Math.round(base + amp * Math.sin(i / 2)),
  }));

export const StableAndRisingTrends: Story = {
  name: "trends — stable, rising, at the ceiling",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-stack">
        <Row gap={10} align="center">
          <Text size="sm">Stable</Text>
          <Sparkline name="CPU" points={wave(40, 5)} tone="accent" />
        </Row>
        <Row gap={10} align="center">
          <Text size="sm">Rising</Text>
          <Sparkline
            name="Memory"
            points={wave(0, 0, 20).map((p, i) => ({ ...p, value: 20 + i * 3 }))}
            tone="wait"
          />
        </Row>
        <Row gap={10} align="center">
          <Text size="sm">At the ceiling</Text>
          <Sparkline name="Disk" points={wave(95, 3)} tone="bad" />
        </Row>
      </div>
    </Stack>
  ),
};

export const GapInSeriesAndShortHistory: Story = {
  name: "a gap in the series doesn't connect both edges / insufficient history",
  render: () => {
    const withGap = wave(50, 10).map((p, i) => (i >= 8 && i <= 12 ? { ...p, value: null } : p));
    return (
      <Stack gap={10}>
        <div className="dsd-stack">
          <Row gap={10} align="center">
            <Text size="sm">Gap (missing measurement)</Text>
            <Sparkline name="CPU" points={withGap} tone="accent" />
          </Row>
          <Row gap={10} align="center">
            <Text size="sm">A single point: nothing gets drawn</Text>
            <Sparkline name="CPU" points={[{ at: 0, value: 42 }]} tone="accent" />
            <Text tone="subtle" size="sm">
              (component absent — the screen shows something else instead)
            </Text>
          </Row>
        </div>
      </Stack>
    );
  },
};
