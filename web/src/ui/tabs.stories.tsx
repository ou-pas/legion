// The task page tabs. The "PR" tab only exists if the task has a pr.md; the bar absorbs it without
// anything jumping. Left/right arrows navigate (wrapping), Home/End go to the ends; the inactive
// panel is unmounted (an SSE timeline must not live backstage).

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Clock, GitPullRequest } from "lucide-react";
import { Button } from "./button.js";
import { Stack } from "./flex.js";

import { Tab, TabList, TabPanel, Tabs } from "./tabs.js";

const meta = { title: "ui / Tabs · underline" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const TRACE = [
  ["09:14:02", "repo_ready", "front · ./repos/front · legion/checkout"],
  ["09:14:07", "tool_start", "Read /repos/front/src/checkout/PaymentForm.tsx"],
  ["09:14:11", "tool_end", "3,821 ms"],
  ["09:15:40", "repo_push", "front · 7 changes · 5f0be31"],
] as const;

export const ThreeTabsOneConditional: Story = {
  name: "3 tabs, 1 conditional",
  render: function Render() {
    const [hasPr, setHasPr] = useState(true);
    const [tab, setTab] = useState("timeline");
    return (
      <Stack gap={10}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabList label="Task views">
            <Tab value="timeline" icon={<Clock size={14} />}>
              Timeline
            </Tab>
            <Tab value="artifacts" count={3}>
              Artifacts
            </Tab>
            {hasPr && (
              <Tab value="pr" icon={<GitPullRequest size={14} />}>
                PR
              </Tab>
            )}
          </TabList>
          <TabPanel value="timeline">
            <div className="dsn-trace">
              {TRACE.map(([time, type, body]) => (
                <div className="dsn-trace-row" key={time}>
                  <span className="dsn-trace-time">{time}</span>
                  <span className="dsn-trace-type">{type}</span>
                  <span className="dsn-trace-body">{body}</span>
                </div>
              ))}
            </div>
          </TabPanel>
          <TabPanel value="artifacts">
            <div className="dsn-pane">spec.md · pr.md · vat-report.pdf</div>
          </TabPanel>
          <TabPanel value="pr">
            <div className="dsn-pane">
              Draft written by senior-dev on legion/checkout — 7 files.
            </div>
          </TabPanel>
        </Tabs>
        <div className="dsn-toggle">
          <Button size="sm" variant="quiet" onClick={() => setHasPr((v) => !v)}>
            {hasPr ? "Remove pr.md from the task" : "The task produces a pr.md"}
          </Button>
        </div>
      </Stack>
    );
  },
};

export const CountDisabled: Story = {
  name: "counter, disabled",
  render: () => {
    return (
      <Stack gap={10}>
        <Tabs defaultValue="ouvertes">
          <TabList label="Inbox questions">
            <Tab value="ouvertes" count={2}>
              Open
            </Tab>
            <Tab value="repondues" count={0}>
              Answered
            </Tab>
            <Tab value="archive" disabled>
              Archive
            </Tab>
          </TabList>
          <TabPanel value="ouvertes">
            <div className="dsn-pane">
              PDF export pagination: one page per order, or a continuous table?
            </div>
          </TabPanel>
          <TabPanel value="repondues">
            <div className="dsn-pane">Nothing answered today.</div>
          </TabPanel>
        </Tabs>
      </Stack>
    );
  },
};
