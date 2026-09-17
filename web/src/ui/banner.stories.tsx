// A full-width band above content. Tone is carried by the triplet's wash and line, never by a
// thick left border. role=alert for bad, role=status for the rest.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { GitMerge, Inbox, RotateCcw } from "lucide-react";
import { Banner } from "./banner.js";
import { Button } from "./button.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / Banner" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

const RUN_ERROR = "Timeout after 600s — heap out of memory at 512 invoices";

export const Info: Story = {
  name: "info",
  render: () => {
    return (
      <Stack gap={10}>
        <Banner title="The Demo (mock) project is read-only.">
          Sessions there are replayed from a recording: no container starts, no cost is billed.
        </Banner>
      </Stack>
    );
  },
};

export const WaitAction: Story = {
  name: "wait + action",
  render: () => {
    return (
      <Stack gap={10}>
        <Banner
          tone="wait"
          title="senior-dev is waiting for your answer for 14 min"
          actions={
            <Button size="sm" leading={<Inbox size={13} />}>
              Open the inbox
            </Button>
          }
        >
          PDF export of monthly reports: one page per order, or a continuous table?
        </Banner>
      </Stack>
    );
  },
};

export const GateTwoActions: Story = {
  name: "gate + two actions",
  render: () => {
    return (
      <Stack gap={10}>
        <Banner
          tone="gate"
          title="Stripe Checkout payment tunnel redesign needs approval"
          actions={
            <>
              <Button size="sm" variant="quiet">
                View the diff
              </Button>
              <Button size="sm" variant="primary" leading={<GitMerge size={13} />}>
                Approve
              </Button>
            </>
          }
        >
          The session modified src/payments/stripe.ts — the merge onto legion/checkout is on hold.
        </Banner>
      </Stack>
    );
  },
};

export const OkDismiss: Story = {
  name: "ok + close",
  render: () => {
    return (
      <Stack gap={10}>
        <Banner tone="ok" title='"stripe-payments" rule added — 3 agents updated' onClose={noop} />
      </Stack>
    );
  },
};

export const BadActionDismiss: Story = {
  name: "bad + action + close",
  render: () => {
    return (
      <Stack gap={10}>
        <Banner
          tone="bad"
          title='The session for "Bulk-generate PDF invoices" has stopped'
          onClose={noop}
          actions={
            <Button size="sm" leading={<RotateCcw size={13} />}>
              Retry
            </Button>
          }
        >
          {RUN_ERROR} — the container was destroyed, no artifact was filed.
        </Banner>
      </Stack>
    );
  },
};

export const TitleOnlyWithoutBody: Story = {
  name: "title alone, no body",
  render: () => {
    return (
      <Stack gap={10}>
        <Banner
          tone="info"
          title="Multi-host Docker: home-server has been unreachable since 08:12."
        />
      </Stack>
    );
  },
};
