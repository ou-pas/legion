// Keyboard drag handle. Opening is the frequent gesture, moving the rare one: shrinking the click
// to a handle would have penalised it. So the keyboard counterpart is NOT always visible: the
// screen-reader-only recipe (.ui-sr, base.css), reduced to 1px and clipped, restored by
// :focus-visible only, never on hover. Tab to the button below to reveal it; Shift+Tab to send it
// away. The whole card is the pointer drag surface (decision 23/08) and stays clickable to open.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { GripVertical } from "lucide-react";
import { Stack } from "./flex.js";

const meta = { title: "ui / Keyboard drag handle" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AtRestOffscreenTabToReveal: Story = {
  name: "at rest (off-screen) → Tab to reveal keyboard focus",
  render: () => (
    <Stack gap={10}>
      <div className="dsf-handle-demo">
        <div className="ui-sortable-card">
          <div className="ui-sortable-card-content">
            <strong>Stripe Checkout payment tunnel redesign</strong>
            <span className="dsf-quiet">senior-dev · high priority · complex</span>
          </div>
          <button
            type="button"
            className="ui-sortable-card-handle"
            aria-label='Move "Stripe Checkout payment tunnel redesign" on the board — Space then arrows'
          >
            <GripVertical size={13} aria-hidden="true" />
            move
          </button>
        </div>
      </div>
    </Stack>
  ),
};
