// Two ratios for the whole app, nothing else. Under 900 px the support column moves below the
// content.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./card.js";
import { Stack } from "./flex.js";
import { SplitPane } from "./split.js";

const meta = { title: "ui / SplitPane" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const RatioAside: Story = {
  name: 'ratio "aside"',
  render: () => {
    return (
      <Stack gap={10}>
        <SplitPane
          label="Goal guardrails"
          main={
            <Card title="Planned steps · 4 steps">
              <div className="dsl-quiet">
                1. Spec out the tunnel — spec · 2. Implement Stripe Checkout — senior-dev · 3. PDF
                export — spec · 4. E2E tests — senior-dev
              </div>
            </Card>
          }
          aside={
            <Card title="Guardrails">
              <Stack gap={6}>
                <span className="dsl-quiet">Budget $5.00 · spent $2.87</span>
                <span className="dsl-quiet">Max iterations 8 · in progress 5</span>
                <span className="dsl-quiet">Gates: diff out of scope</span>
              </Stack>
            </Card>
          }
        />
      </Stack>
    );
  },
};

export const RatioHalf: Story = {
  name: 'ratio "half"',
  render: () => {
    return (
      <Stack gap={10}>
        <SplitPane
          ratio="half"
          label="Task session"
          main={<Card title="Task">Stripe Checkout payment tunnel redesign</Card>}
          aside={<Card title="Session">legion-sess-8f2a · senior-dev · 19 min</Card>}
        />
      </Stack>
    );
  },
};
