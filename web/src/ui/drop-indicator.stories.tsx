// Covers the card being moved, which stays in the DOM but is hidden (visibility: hidden) by the
// caller: the placeholder inherits its real, content-dependent height without measuring it. Set
// by SortableTaskCard during a board drag.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { DropIndicator } from "./drop-indicator.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / DropIndicator" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const LiftedCardWithPlaceholder: Story = {
  name: "card lifted — content hidden, placeholder on top",
  render: () => (
    <Stack gap={10}>
      <div className="dsf-drop-demo">
        <div className="dsf-drop-demo-ghost">
          <strong>Stripe Checkout payment tunnel redesign</strong>
          <span className="dsf-quiet">senior-dev · high priority · complex</span>
        </div>
        <DropIndicator />
      </div>
    </Stack>
  ),
};
