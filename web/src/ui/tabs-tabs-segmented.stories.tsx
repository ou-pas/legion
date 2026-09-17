// Picking a view (same content, different cut). unmountInactive={false}: panels keep their scroll
// state from one view to the next.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Clock, FileText, LayoutGrid } from "lucide-react";
import { Stack } from "./flex.js";
import { Tab, TabList, TabPanel, Tabs } from "./tabs.js";

const meta = { title: "ui / Tabs · segmented" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ViewChoice: Story = {
  name: "view selection",
  render: function Render() {
    const [view, setView] = useState("board");
    return (
      <Stack gap={10}>
        <Tabs value={view} onValueChange={setView} variant="segmented" unmountInactive={false}>
          <TabList label="Project view">
            <Tab value="board" icon={<LayoutGrid size={14} />}>
              Board
            </Tab>
            <Tab value="liste" icon={<FileText size={14} />}>
              List
            </Tab>
            <Tab value="chrono" icon={<Clock size={14} />} count={12}>
              Timeline
            </Tab>
            <Tab value="archive" disabled>
              Archive
            </Tab>
          </TabList>
          <TabPanel value="board">
            <div className="dsn-pane">4 columns · todo 3 · doing 2 · review 3 · done 3</div>
          </TabPanel>
          <TabPanel value="liste">
            <div className="dsn-pane">12 tasks, sorted by priority then complexity.</div>
          </TabPanel>
          <TabPanel value="chrono">
            <div className="dsn-pane">12 tasks over the last 14 days.</div>
          </TabPanel>
        </Tabs>
      </Stack>
    );
  },
};
