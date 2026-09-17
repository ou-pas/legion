import type { Meta, StoryObj } from "@storybook/react-vite";
import { InboundWebhooksCard } from "./inbound-webhooks-card.js";

const meta = { title: "Integrations/InboundWebhooksCard" } satisfies Meta;
export default meta;
type Story = StoryObj;

const noop = () => Promise.resolve();

export const NotSetUpYet: Story = {
  name: "no public URL — nothing can ring",
  render: () => (
    <InboundWebhooksCard
      state={{ baseUrl: null, secretReady: false, connectedRepos: 0 }}
      onSaveBaseUrl={noop}
    />
  ),
};

export const ReadyWithoutRepo: Story = {
  name: "URL set, secret generated, no repo connected",
  render: () => (
    <InboundWebhooksCard
      state={{ baseUrl: "https://mini.tail1abc.ts.net", secretReady: true, connectedRepos: 0 }}
      onSaveBaseUrl={noop}
    />
  ),
};

export const Connected: Story = {
  name: "three repos connected",
  render: () => (
    <InboundWebhooksCard
      state={{ baseUrl: "https://mini.tail1abc.ts.net", secretReady: true, connectedRepos: 3 }}
      onSaveBaseUrl={noop}
    />
  ),
};

export const RegistrationRefused: Story = {
  name: "URL refused — the server names the reason",
  render: () => (
    <InboundWebhooksCard
      state={{ baseUrl: null, secretReady: false, connectedRepos: 0 }}
      onSaveBaseUrl={noop}
      saveError="Invalid public URL: https://… expected (the funnel host, no path)"
    />
  ),
};

export const Loading: Story = {
  name: "state not read yet (loading)",
  render: () => <InboundWebhooksCard onSaveBaseUrl={noop} />,
};
