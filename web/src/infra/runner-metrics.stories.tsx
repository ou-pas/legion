// The three measures of a runner (VM, machine, disk; v52, 02/09) in every state a real fleet
// produces: fresh, missing (with its reason), machine asleep (last measure before sleeping, aged),
// stale values.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { HistoryPoint, RunnerMetrics } from "../api/infra.js";
import { Stack } from "../ui/flex.js";
import { RunnerMetricsCells } from "./runner-metrics.js";
import { Vitals } from "./runner-vitals.js";

const meta = { title: "infra / RunnerMetrics" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const NOW = Date.UTC(2026, 8, 2, 14, 0, 0);
const wave = (base: number, amp: number, at0: number): HistoryPoint[] =>
  Array.from({ length: 20 }, (_, i) => ({
    at: at0 - (19 - i) * 30_000,
    cpu: Math.round(base + amp * Math.sin(i / 2)),
    mem: Math.round(base + 10 + amp * Math.cos(i / 3)),
  }));

export const FreshMeasures: Story = {
  name: "fresh measurements — all three sources respond",
  render: () => {
    const m: RunnerMetrics = {
      vm: { cpuPct: 38, memPct: 61, at: NOW - 5_000 },
      vmReason: null,
      vmHistory: wave(38, 12, NOW),
      host: { cpuPct: 14, memPct: 52, at: NOW - 5_000 },
      hostReason: null,
      hostHistory: wave(14, 8, NOW),
      disk: { usedPct: 47, totalMb: 61_440, at: NOW - 5_000 },
      diskReason: null,
    };
    return (
      <Stack gap={14}>
        <div className="dsd-narrow">
          <Vitals label="Vitals">
            <RunnerMetricsCells metrics={m} now={NOW} />
          </Vitals>
        </div>
      </Stack>
    );
  },
};

export const MissingMeasureWithReason: Story = {
  name: "measurement missing — each source says why",
  render: () => {
    const m: RunnerMetrics = {
      vm: { cpuPct: 22, memPct: 40, at: NOW - 5_000 },
      vmReason: null,
      vmHistory: wave(22, 10, NOW),
      host: null,
      hostReason: "non-Mac host: the measurement relies on sysctl/vm_stat, macOS-specific",
      hostHistory: [],
      disk: null,
      diskReason: "legion-proxy:latest image missing on this runner — run make image",
    };
    return (
      <Stack gap={14}>
        <div className="dsd-narrow">
          <Vitals label="Vitals">
            <RunnerMetricsCells metrics={m} now={NOW} />
          </Vitals>
        </div>
      </Stack>
    );
  },
};

export const MachineAsleep: Story = {
  name: "machine asleep — last measurement before it slept, very old",
  render: () => {
    const before = NOW - 9 * 3600 * 1000; // the Mac has slept since last night
    const m: RunnerMetrics = {
      vm: { cpuPct: 5, memPct: 30, at: before },
      vmReason: null,
      vmHistory: wave(5, 3, before),
      host: { cpuPct: 2, memPct: 45, at: before },
      hostReason: null,
      hostHistory: wave(2, 2, before),
      disk: { usedPct: 62, totalMb: 61_440, at: before },
      diskReason: null,
    };
    return (
      <Stack gap={14}>
        <div className="dsd-narrow">
          <Vitals label="Vitals">
            <RunnerMetricsCells metrics={m} now={NOW} />
          </Vitals>
        </div>
      </Stack>
    );
  },
};

export const StaleValuesDiskAlert: Story = {
  name: "stale values (45 min) and disk in alert / at max",
  render: () => {
    const stale = NOW - 45 * 60 * 1000;
    const m: RunnerMetrics = {
      vm: { cpuPct: 55, memPct: 70, at: stale },
      vmReason: null,
      vmHistory: wave(55, 15, stale),
      host: { cpuPct: 20, memPct: 58, at: stale },
      hostReason: null,
      hostHistory: wave(20, 8, stale),
      disk: { usedPct: 87, totalMb: 61_440, at: stale },
      diskReason: null,
    };
    const full: RunnerMetrics = { ...m, disk: { usedPct: 97, totalMb: 61_440, at: stale } };
    return (
      <Stack gap={14}>
        <div className="dsd-narrow">
          <Vitals label="Vitals">
            <RunnerMetricsCells metrics={m} now={NOW} />
          </Vitals>
        </div>
        <div className="dsd-narrow">
          <Vitals label="Vitals">
            <RunnerMetricsCells metrics={full} now={NOW} />
          </Vitals>
        </div>
      </Stack>
    );
  },
};

export const NeverMeasured: Story = {
  name: "never measured — runner just declared, or server restarted",
  render: () => {
    const m: RunnerMetrics = {
      vm: null,
      vmReason: "not measured yet",
      vmHistory: [],
      host: null,
      hostReason: "not measured yet",
      hostHistory: [],
      disk: null,
      diskReason: "not measured yet",
    };
    return (
      <Stack gap={14}>
        <div className="dsd-narrow">
          <Vitals label="Vitals">
            <RunnerMetricsCells metrics={m} now={NOW} />
          </Vitals>
        </div>
      </Stack>
    );
  },
};
