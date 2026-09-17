// A registry of rows: what the card is not. Header on a sunken surface, rows separated by a rule,
// notes in between.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Network, Trash2 } from "lucide-react";
import { Button } from "./button.js";
import { Spacer, Stack } from "./flex.js";
import { Panel, PanelHeader, PanelNote, PanelRow } from "./panel.js";

const meta = { title: "ui / Panel" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const FullRegistry: Story = {
  name: "full register",
  render: () => {
    return (
      <Stack gap={10}>
        <Panel>
          <PanelHeader
            title="home-server"
            actions={
              <Button size="sm" icon={<Trash2 size={12} />}>
                Clean up 2 orphans
              </Button>
            }
          >
            <span className="dsl-num">docker ok</span>
          </PanelHeader>
          <PanelNote tone="wait">
            No session image on this runner — no session will be able to start: run make image.
          </PanelNote>
          <PanelRow icon={<Box size={13} />}>
            <span className="dsl-mono">legion-sess-8f2a</span>
            <Spacer />
            <span className="dsl-quiet">senior-dev · Payment tunnel redesign</span>
          </PanelRow>
          <PanelRow icon={<Box size={13} />}>
            <span className="dsl-mono">legion-proxy-8f2a</span>
            <Spacer />
            <span className="dsl-quiet">egress allowlist · 4 domains</span>
          </PanelRow>
          <PanelRow icon={<Network size={13} />}>
            <span className="dsl-mono">legion-net-3b71</span>
            <Spacer />
            <span className="dsl-quiet">orphan</span>
          </PanelRow>
          <PanelNote tone="bad">
            Partial cleanup — failures: legion-net-3b71 (active endpoint).
          </PanelNote>
        </Panel>
      </Stack>
    );
  },
};

export const HeaderOnlyNeutralNote: Story = {
  name: "header alone + neutral note",
  render: () => {
    return (
      <Stack gap={10}>
        <Panel>
          <PanelHeader title="local machine" />
          <PanelNote>No legion-* container: the last one was cleaned up at 14:22.</PanelNote>
        </Panel>
      </Stack>
    );
  },
};
