// An empty state is a screen, not a centred grey sentence: a drawn plate, the reason, and the way
// out. "cleared" is the only empty state that is good news.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileDown, Play } from "lucide-react";
import { Button } from "./button.js";
import { Empty } from "./empty.js";
import { Stack } from "./flex.js";
import { Panel, PanelHeader } from "./panel.js";

const meta = { title: "ui / Empty" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const PageGoodNews: Story = {
  name: "page — good news",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsf-sheet">
          <Empty
            variant="page"
            art="cleared"
            title="Your board is clear"
            action={
              <Button variant="primary" leading={<Play size={13} />}>
                Run a task
              </Button>
            }
          >
            No decision is waiting for you and no session is running. The 12 tasks in the Demo
            (mock) project are either done or ready to go: the next agent will start when you
            decide.
          </Empty>
        </div>
      </Stack>
    );
  },
};

export const PageNothingYet: Story = {
  name: "page — nothing exists yet",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsf-sheet">
          <Empty
            variant="page"
            title="No goal on this project"
            action={<Button variant="primary">Describe a goal</Button>}
          >
            A goal describes an outcome ("no more phantom orders"), not a list of tasks: the
            orchestrator derives the steps from it and hands them to agents.
          </Empty>
        </div>
      </Stack>
    );
  },
};

export const PanelInCard: Story = {
  name: "panel — inside a card",
  render: () => {
    return (
      <Stack gap={10}>
        <Panel>
          <PanelHeader icon={<FileDown size={14} />} title="Session artifacts" />
          <Empty
            variant="panel"
            title="No artifact filed"
            action={<Button size="sm">Open the timeline</Button>}
          >
            senior-dev hasn't written anything to /artifacts yet. Deliverables appear here as soon
            as the first file lands.
          </Empty>
        </Panel>
      </Stack>
    );
  },
};

export const InlineFilterTooNarrow: Story = {
  name: "inline — filter too narrow",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsf-sheet">
          <Empty
            variant="inline"
            art="filtered"
            title='No task matches "invoice"'
            action={
              <Button size="sm" variant="quiet">
                Widen the filter
              </Button>
            }
          >
            3 tasks are hidden by the "my tasks" filter.
          </Empty>
        </div>
      </Stack>
    );
  },
};
