// The only module allowed to style its descendants: content (project context, a rule body)
// arrives without classes.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./flex.js";
import { Prose } from "./prose.js";

const meta = { title: "ui / Prose" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const RULE = `Any change to /src/checkout/ goes through a session with the spec agent before
implementation: the payment tunnel is never touched without a written spec.`;

export const DefaultMeasure: Story = {
  name: "default (measure)",
  render: () => (
    <Stack gap={10}>
      <Prose>
        <p>
          Acme v2: React front, Node back. The payment tunnel goes through hosted Stripe Checkout;
          webhooks are received by <code>/api/stripe/hooks</code> and replayed from{" "}
          <code>scripts/replay.ts</code> in case of an incident.
        </p>
        <p>
          An agent that touches payments must produce a <strong>specification</strong> before any
          patch, and open its branch under <code>legion/</code>.
        </p>
        <ul>
          <li>
            Assigned repos: <code>front</code>, <code>api</code>.
          </li>
          <li>Accessible secrets: none in plaintext, everything goes through the egress proxy.</li>
          <li>Expected artifacts: diff, tunnel capture, session log.</li>
        </ul>
      </Prose>
    </Stack>
  ),
};

export const SmMuted: Story = {
  name: "sm + muted",
  render: () => (
    <Stack gap={10}>
      <Prose size="sm" tone="muted">
        <p>{RULE}</p>
      </Prose>
    </Stack>
  ),
};
