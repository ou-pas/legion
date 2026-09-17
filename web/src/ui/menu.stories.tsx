import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown, RotateCcw, Square, Terminal, Trash2 } from "lucide-react";
import { Row } from "./flex.js";
import { Menu, MenuItem, MenuSeparator } from "./menu.js";

const meta = { title: "ui / Menu" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SessionActions: Story = {
  name: "session actions",
  render: () => (
    <Row gap={10} wrap>
      <Menu label="Session actions">
        <MenuItem icon={<Square size={14} />} onSelect={() => {}}>
          Stop
        </MenuItem>
        <MenuItem icon={<Terminal size={14} />} shortcut="⌘⇧T" onSelect={() => {}}>
          Resume in the terminal
        </MenuItem>
        <MenuItem icon={<RotateCcw size={14} />} disabled>
          Retry (session destroyed)
        </MenuItem>
        <MenuSeparator />
        {/* Two steps in place (task-actions-bar.tsx): the first click arms without closing the
            menu, the second deletes and closes. */}
        <MenuItem
          icon={<Trash2 size={14} />}
          danger
          confirmLabel="Delete the task?"
          onSelect={() => {}}
        >
          Delete
        </MenuItem>
      </Menu>
      <Menu
        label="Agent model: claude-sonnet-5"
        align="start"
        trigger={
          <>
            claude-sonnet-5
            <ChevronDown size={13} />
          </>
        }
      >
        <MenuItem onSelect={() => {}}>claude-opus-5</MenuItem>
        <MenuItem onSelect={() => {}}>claude-sonnet-5</MenuItem>
        <MenuItem onSelect={() => {}}>claude-haiku-4-5</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => {}}>Project default model</MenuItem>
      </Menu>
      <Menu
        label="Move the task (right-aligned)"
        align="end"
        trigger={
          <>
            Move the task
            <ChevronDown size={13} />
          </>
        }
      >
        <MenuItem onSelect={() => {}}>todo</MenuItem>
        <MenuItem onSelect={() => {}}>review</MenuItem>
        <MenuItem onSelect={() => {}}>done</MenuItem>
      </Menu>
    </Row>
  ),
};
