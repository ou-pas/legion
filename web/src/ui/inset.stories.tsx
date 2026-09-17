// A recessed block INSIDE a card: one step down, not a second sheet.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./card.js";
import { Stack } from "./flex.js";
import { Inset } from "./inset.js";

const meta = { title: "ui / Inset" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const NeutralSunken: Story = {
  name: "neutral recess",
  render: () => {
    return (
      <Stack gap={10}>
        <Card title="Definition of Done">
          <Inset label="Commit preview">
            <span className="dsl-mono">9c1f0ab · legion/checkout · 214 ++ / 38 --</span>
          </Inset>
        </Card>
      </Stack>
    );
  },
};

export const AccentTintAwaitingDecision: Story = {
  name: "accent tone (waiting for a decision)",
  render: () => {
    return (
      <Stack gap={10}>
        <Card title="Approval gate">
          <Inset tone="accent" label="Requested by senior-dev">
            Change to <span className="dsl-mono">src/payments/stripe.ts</span> — outside the task's
            declared scope.
          </Inset>
        </Card>
      </Stack>
    );
  },
};
