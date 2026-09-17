// Presentational: the list, the kill switch and the failures come from props, not a real
// notification server.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WebhooksCard } from "./webhooks-card.js";
import type { Webhook } from "../api/notifications.js";

const meta = { title: "notifications / WebhooksCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = async () => {};
const EVENTS = ["standup", "task.done", "goal.done", "gate.waiting", "session.failed"];

const WEBHOOKS: Webhook[] = [
  {
    id: "w1",
    url: "https://hooks.slack.com/services/T0/B0/xyz",
    events: [],
    enabled: true,
    createdAt: "2026-08-20T08:00:00Z",
  },
  {
    id: "w2",
    url: "https://example.com/legion/webhook",
    events: ["task.done", "gate.waiting"],
    enabled: true,
    createdAt: "2026-08-28T14:00:00Z",
  },
];

export const Empty: Story = {
  name: "empty — nothing is notified yet",
  render: () => (
    <WebhooksCard enabled webhooks={[]} allEvents={EVENTS} onCreate={noop} onDelete={() => {}} />
  ),
};

export const Registered: Story = {
  name: 'two webhooks — one "all", one filtered',
  render: () => (
    <WebhooksCard
      enabled
      webhooks={WEBHOOKS}
      allEvents={EVENTS}
      onCreate={noop}
      onDelete={() => {}}
    />
  ),
};

export const KillSwitchOff: Story = {
  name: "cut at the rail — nothing goes out despite the config",
  render: () => (
    <WebhooksCard
      enabled={false}
      webhooks={WEBHOOKS}
      allEvents={EVENTS}
      onCreate={noop}
      onDelete={() => {}}
    />
  ),
};

export const Creating: Story = {
  name: "adding",
  render: () => (
    <WebhooksCard
      enabled
      webhooks={WEBHOOKS}
      allEvents={EVENTS}
      creating
      onCreate={noop}
      onDelete={() => {}}
    />
  ),
};

export const CreateRefused: Story = {
  name: "creation refused",
  render: () => (
    <WebhooksCard
      enabled
      webhooks={WEBHOOKS}
      allEvents={EVENTS}
      createError="This URL is already registered."
      onCreate={noop}
      onDelete={() => {}}
    />
  ),
};

export const Deleting: Story = {
  name: "deleting — only its trash icon spins",
  render: () => (
    <WebhooksCard
      enabled
      webhooks={WEBHOOKS}
      allEvents={EVENTS}
      deletingId="w1"
      onCreate={noop}
      onDelete={() => {}}
    />
  ),
};

export const DeleteFailed: Story = {
  name: "deletion failed",
  render: () => (
    <WebhooksCard
      enabled
      webhooks={WEBHOOKS}
      allEvents={EVENTS}
      deleteError="The webhook couldn't be deleted: the server isn't responding."
      onCreate={noop}
      onDelete={() => {}}
    />
  ),
};
