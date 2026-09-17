// An anchored NON-modal surface: no focus trap, the rest of the screen stays usable. Escape and
// outside click close it.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Calendar } from "lucide-react";
import { Row, Stack } from "./flex.js";
import { Field } from "./form.js";
import { Input } from "./input.js";
import { Popover } from "./popover.js";

const meta = { title: "ui / Popover" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const HoverAndKeyboardFocus: Story = {
  name: "hover (and keyboard focus)",
  render: () => (
    <Row gap={10} wrap>
      <Popover
        openOn="hover"
        label="writer agent's permissions"
        trigger={<span className="dsn-pastille">writer · limited network</span>}
      >
        <Stack gap={4}>
          <b>writer</b>
          <span>Network: allowlist (api.anthropic.com)</span>
          <span>Write: /agents/writer only</span>
          <span>MCP: none</span>
        </Stack>
      </Popover>
    </Row>
  ),
};

export const ClickToOpen: Story = {
  name: "click",
  render: () => (
    <Row gap={10} wrap>
      <Popover
        label="Period: last 14 days"
        side="bottom"
        align="start"
        trigger={
          <span className="dsn-pastille">
            <Calendar size={13} />
            last 14 days
          </span>
        }
      >
        <Stack gap={6}>
          <span>From 05/08 to 19/08 · 12 tasks, 8 sessions</span>
          <Field label="Start">
            <Input type="date" value="2026-08-05" onChange={() => {}} />
          </Field>
          <Field label="End">
            <Input type="date" value="2026-08-19" onChange={() => {}} />
          </Field>
        </Stack>
      </Popover>
    </Row>
  ),
};
