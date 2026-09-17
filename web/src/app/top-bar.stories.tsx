// The status group of the bar: sessions, the inbox button (a slot since 02/09, frameless, just
// before docker, at the operator's request), docker (opens a card of the whole fleet on
// hover/focus) and update.
//
// Only the pure form is shown. The full bar holds queries, a palette, a theme and a router;
// mounting it here would prove the providers work, not that the bar reads well. The inbox slot
// gets the real `PendingButton` (with a fake panel) to check how it sits among the group.
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InfraRunner } from "../api/infra.js";
import { StatusGroup } from "./top-bar.js";
import { PendingButton } from "../inbox/pending-panel.js";
import { TopBar } from "../ui/shell.js";

const pendingSlot = (count: number) => (
  <PendingButton count={count}>
    <div />
  </PendingButton>
);

const meta = { title: "app / Bar status group (StatusGroup)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const mockRunners = (overrides?: Partial<InfraRunner>[]): InfraRunner[] => {
  const defaults = {
    available: true,
    dockerHost: null,
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
  };
  return [
    { runnerId: "runner-1", runnerName: "MacBook", ...defaults, ...overrides?.[0] },
    { runnerId: "runner-2", runnerName: "Mini (VM)", ...defaults, running: 0, ...overrides?.[1] },
  ];
};

export const Nominal: Story = {
  name: "2 sessions, 1 waiting (pulsing pill), docker ok, healthy fleet",
  render: () => (
    <TopBar>
      <StatusGroup
        sessions={2}
        pendingSlot={pendingSlot(1)}
        docker={null}
        runners={mockRunners()}
      />
    </TopBar>
  ),
};

export const AtRest: Story = {
  name: "0 sessions, 0 waiting, docker ok, empty fleet",
  render: () => (
    <TopBar>
      <StatusGroup
        sessions={0}
        pendingSlot={pendingSlot(0)}
        docker={null}
        runners={mockRunners()}
      />
    </TopBar>
  ),
};

export const WithPending: Story = {
  name: "3 sessions, 2 waiting (pulsing pill), docker ok",
  render: () => (
    <TopBar>
      <StatusGroup
        sessions={3}
        pendingSlot={pendingSlot(2)}
        docker={null}
        runners={mockRunners()}
      />
    </TopBar>
  ),
};

export const OneRunnerDown: Story = {
  name: "fleet with 1 runner down — card shows a red and a green badge",
  render: () => (
    <TopBar>
      <StatusGroup
        sessions={1}
        pendingSlot={pendingSlot(0)}
        docker={null}
        runners={mockRunners([{ available: false, error: "Connection refused" }])}
      />
    </TopBar>
  ),
};

export const AllRunnersDown: Story = {
  name: "all runners unreachable — red pill, 0 waiting",
  render: () => (
    <TopBar>
      <StatusGroup
        sessions={0}
        pendingSlot={pendingSlot(0)}
        docker="daemon"
        runners={mockRunners([
          { available: false, error: "Timeout" },
          { available: false, error: "Timeout" },
        ])}
      />
    </TopBar>
  ),
};

export const UpdateInProgress: Story = {
  name: "update under way — discreet pill, visible from any screen",
  render: () => (
    <TopBar>
      <StatusGroup
        sessions={0}
        pendingSlot={pendingSlot(0)}
        docker={null}
        runners={mockRunners()}
        updating
      />
    </TopBar>
  ),
};

export const ImageMissingRunner: Story = {
  name: "missing image on 1 runner — orange pill, 1 waiting (pulsing)",
  render: () => (
    <TopBar>
      <StatusGroup
        sessions={0}
        pendingSlot={pendingSlot(1)}
        docker="image"
        runners={mockRunners([
          {},
          {
            image: {
              present: false,
              builtHash: null,
              currentHash: null,
              stale: true,
              rebuilding: false,
            },
          },
        ])}
      />
    </TopBar>
  ),
};
