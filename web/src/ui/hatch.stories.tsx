// The marker validated in the Atelier mock-up: edge hatching (tokens --hatch-step / --hatch-gap /
// --hatch-angle, tint --gate-hatch or --bad-hatch) plus an icon. Never a thick border-left.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox, ShieldX, Stamp } from "lucide-react";
import { Code } from "./code.js";
import { Stack } from "./flex.js";
import { Hatch } from "./hatch.js";
import { Panel, PanelHeader } from "./panel.js";

const meta = { title: "ui / Hatch" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const FS_DENIED = "write /repos/front/package.json — outside the granted folders";

export const GateWholeCard: Story = {
  name: "gate — whole card",
  render: () => {
    return (
      <Stack gap={10}>
        <Hatch tone="gate" icon={<Stamp size={14} />}>
          <strong>Stripe Checkout payment tunnel redesign</strong> is waiting for your approval
          before merge. The session modified src/payments/stripe.ts and 6 other files on
          legion/checkout.
        </Hatch>
      </Stack>
    );
  },
};

export const BadHostRefusal: Story = {
  name: "bad — refused by the host",
  render: () => (
    <Stack gap={10}>
      <Hatch tone="bad" icon={<ShieldX size={14} />}>
        Write refused: <Code>{FS_DENIED}</Code>. The agent continued without this file.
      </Hatch>
    </Stack>
  ),
};

export const NeutralSetAside: Story = {
  name: "neutral — set aside",
  render: () => (
    <Stack gap={10}>
      <Hatch tone="neutral" icon={<Inbox size={14} />}>
        Goal "Loyalty program" — draft, never launched.
      </Hatch>
    </Stack>
  ),
};

export const RightEdge: Story = {
  name: "edge on the right",
  render: () => {
    return (
      <Stack gap={10}>
        <Hatch tone="gate" side="right" icon={<Stamp size={14} />}>
          PDF export of monthly reports is waiting for approval — the mark moves to the right when
          the left column already carries the task's status.
        </Hatch>
      </Stack>
    );
  },
};

export const RegistryRowsFlattenedByCaller: Story = {
  name: "as register rows (frame flattened by the caller)",
  render: () => {
    return (
      <Stack gap={10}>
        <Panel>
          <PanelHeader title="Approval queue" />
          <Hatch tone="gate" side="left" icon={<Stamp size={14} />} className="dsf-hatch-row">
            PDF export of monthly reports — approval gate, session waiting in the inbox.
          </Hatch>
          <Hatch tone="gate" side="left" icon={<Stamp size={14} />} className="dsf-hatch-row">
            Stripe Checkout payment tunnel redesign — approval gate, in review.
          </Hatch>
          <Hatch tone="bad" side="left" icon={<ShieldX size={14} />} className="dsf-hatch-row">
            Bulk-generate PDF invoices — session failed, nothing to approve.
          </Hatch>
        </Panel>
      </Stack>
    );
  },
};
