// Presentational: the five states come from props, not a real browser. That is the point of
// separating it from the hook: "iOS in a Safari tab" cannot be reproduced on a development
// machine, and it is the state whose sentence matters most.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PushCard } from "./push-card.js";
import type { PushSubscriptionSummary } from "../api/notifications.js";

const meta = { title: "notifications / PushCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

const DEVICES: PushSubscriptionSummary[] = [
  {
    id: "p1",
    label: "iPhone",
    events: [],
    createdAt: "2026-09-13T18:00:00Z",
    lastSeenAt: "2026-09-13T19:30:00Z",
    endpointTail: "a91f3c02de77",
  },
  {
    id: "p2",
    label: "Mac",
    events: ["gate_waiting", "task_failed"],
    createdAt: "2026-09-10T09:00:00Z",
    lastSeenAt: "2026-09-12T21:05:00Z",
    endpointTail: "0cc41be9fa10",
  },
];

export const Ready: Story = {
  name: "ready — no device subscribed",
  render: () => (
    <PushCard
      availability={{ state: "ready" }}
      permission="default"
      subscribed={false}
      subscriptions={[]}
      onEnable={noop}
      onDisable={noop}
      onForget={noop}
    />
  ),
};

export const Subscribed: Story = {
  name: "subscribed — two devices, one filtered",
  render: () => (
    <PushCard
      availability={{ state: "ready" }}
      permission="granted"
      subscribed
      subscriptions={DEVICES}
      onEnable={noop}
      onDisable={noop}
      onForget={noop}
    />
  ),
};

export const NeedsHomeScreen: Story = {
  name: "iOS in a tab — needs installing first",
  render: () => (
    <PushCard
      availability={{ state: "needs-home-screen" }}
      permission="default"
      subscribed={false}
      subscriptions={[]}
      onEnable={noop}
      onDisable={noop}
      onForget={noop}
    />
  ),
};

export const Denied: Story = {
  name: "denied — the browser won't ask again",
  render: () => (
    <PushCard
      availability={{ state: "ready" }}
      permission="denied"
      subscribed={false}
      subscriptions={[]}
      onEnable={noop}
      onDisable={noop}
      onForget={noop}
    />
  ),
};

export const Unsupported: Story = {
  name: "browser can't, or insecure origin",
  render: () => (
    <PushCard
      availability={{
        state: "unsupported",
        why: "This browser can't receive push notifications, or the origin isn't secure.",
      }}
      permission="default"
      subscribed={false}
      subscriptions={[]}
      onEnable={noop}
      onDisable={noop}
      onForget={noop}
    />
  ),
};

export const Failed: Story = {
  name: "the subscription failed",
  render: () => (
    <PushCard
      availability={{ state: "ready" }}
      permission="granted"
      subscribed={false}
      subscriptions={[]}
      error="The browser returned an incomplete subscription."
      onEnable={noop}
      onDisable={noop}
      onForget={noop}
    />
  ),
};

export const Muted: Story = {
  name: "subscribed but everything's off — the global switch",
  render: () => (
    <PushCard
      availability={{ state: "ready" }}
      notificationsEnabled={false}
      permission="granted"
      subscribed
      subscriptions={DEVICES}
      onEnable={noop}
      onDisable={noop}
      onForget={noop}
    />
  ),
};
