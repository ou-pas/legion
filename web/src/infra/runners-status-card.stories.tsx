import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InfraRunner } from "../api/infra.js";
import { RunnersStatusCard } from "./runners-status-card.js";

const meta = { title: "infra / RunnersStatusCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const mockRunner = (name: string, overrides?: Partial<InfraRunner>): InfraRunner => ({
  runnerId: `runner-${name.toLowerCase()}`,
  runnerName: name,
  dockerHost: null,
  available: true,
  error: null,
  containers: [],
  networks: [],
  volumes: [],
  zombieSessions: [],
  image: { present: true, builtHash: "abc", currentHash: "abc", stale: false, rebuilding: false },
  sharedImages: [],
  projectImages: [],
  maxConcurrentSessions: 3,
  running: 1,
  memoryMb: 4096,
  cpus: 2,
  hostMemoryMb: 8192,
  lastSeenAt: Date.now(),
  metrics: {
    vm: null,
    vmReason: "N/A",
    vmHistory: [],
    host: null,
    hostReason: "N/A",
    hostHistory: [],
    disk: null,
    diskReason: "N/A",
  },
  ...overrides,
});

export const AllHealthy: Story = {
  name: "Whole fleet healthy — all reachable, green badges",
  render: () => (
    <RunnersStatusCard
      runners={[mockRunner("MacBook", { running: 1 }), mockRunner("Mini (VM)", { running: 0 })]}
      onNavigate={() => alert("Navigate to /infra")}
    />
  ),
};

export const OneDown: Story = {
  name: "One runner down — card shows a red badge, the other green",
  render: () => (
    <RunnersStatusCard
      runners={[
        mockRunner("MacBook", { available: false, error: "Connection refused", running: 0 }),
        mockRunner("Mini (VM)", { running: 0 }),
      ]}
      onNavigate={() => alert("Navigate to /infra")}
    />
  ),
};

export const AllDown: Story = {
  name: "Whole fleet degraded — all badges red",
  render: () => (
    <RunnersStatusCard
      runners={[
        mockRunner("MacBook", { available: false, error: "Timeout", running: 0 }),
        mockRunner("Mini (VM)", { available: false, error: "SSH error", running: 0 }),
      ]}
      onNavigate={() => alert("Navigate to /infra")}
    />
  ),
};

export const ImageMissing: Story = {
  name: "Missing image — orange badge on one machine, green on the other",
  render: () => (
    <RunnersStatusCard
      runners={[
        mockRunner("MacBook", { running: 1 }),
        mockRunner("Mini (VM)", {
          image: {
            present: false,
            builtHash: null,
            currentHash: null,
            stale: true,
            rebuilding: false,
          },
          running: 0,
        }),
      ]}
      onNavigate={() => alert("Navigate to /infra")}
    />
  ),
};
