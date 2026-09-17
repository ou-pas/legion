// Overflow is handled, never hidden: `wrap` breaks the line, `scroll` scrolls on one line (the thin
// scrollbar is the hint).

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pause, Play, Skull, Trash2 } from "lucide-react";
import { Button } from "./button.js";
import { Stack } from "./flex.js";
import { Toolbar } from "./toolbar.js";

const meta = { title: "ui / Toolbar" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const WrapOverflowingActions: Story = {
  name: "wrap · actions overflow",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-narrow">
        <Toolbar label="Goal actions (wrap)">
          <Button size="sm" icon={<Play size={12} />}>
            Retry
          </Button>
          <Button size="sm" icon={<Pause size={12} />}>
            Pause
          </Button>
          <Button size="sm">Reschedule</Button>
          <Button size="sm">Log</Button>
          <Button size="sm" variant="ghost" icon={<Skull size={12} />}>
            Kill switch
          </Button>
        </Toolbar>
      </div>
    </Stack>
  ),
};

export const ScrollOverflowingActions: Story = {
  name: "scroll · actions overflow",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-narrow">
        <Toolbar label="Goal actions (scroll)" overflow="scroll">
          <Button size="sm" icon={<Play size={12} />}>
            Retry
          </Button>
          <Button size="sm" icon={<Pause size={12} />}>
            Pause
          </Button>
          <Button size="sm">Reschedule</Button>
          <Button size="sm">Log</Button>
          <Button size="sm" variant="ghost" icon={<Skull size={12} />}>
            Kill switch
          </Button>
        </Toolbar>
      </div>
    </Stack>
  ),
};

export const RuledEnd: Story = {
  name: "ruled + end",
  render: () => (
    <Stack gap={10}>
      <Toolbar
        label="Task actions"
        variant="ruled"
        end={
          <Button size="sm" variant="ghost" icon={<Trash2 size={12} />}>
            Delete
          </Button>
        }
      >
        <Button size="sm" variant="primary">
          Approve the diff
        </Button>
        <Button size="sm">Request a retry</Button>
      </Toolbar>
    </Stack>
  ),
};

export const BarAreaHeader: Story = {
  name: "bar (zone header)",
  render: () => (
    <Stack gap={10}>
      <Toolbar
        label="Artifact preview"
        variant="bar"
        end={<span className="dsl-mono">diff.patch · 4.2 KB</span>}
      >
        <span className="dsl-quiet">Session 8f2a's artifact</span>
      </Toolbar>
    </Stack>
  ),
};
