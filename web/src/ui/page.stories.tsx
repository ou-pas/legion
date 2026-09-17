// One width for all pages, no `wide` variant. The subtitle is capped at the reading measure.
//
// The FIVE states below cover every combination of `title`/`sub`/`actions`, on purpose: the Goals
// subtitle ended up stuck to the button (operator's capture, 02/09) while PageHeader ALREADY had a
// title+subtitle+actions story, but none with title+subtitle WITHOUT actions or title+actions
// ALONE to compare, so nothing showed the subtitle had left its place.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pause, Play, RefreshCw } from "lucide-react";
import { Button, IconBtn } from "./button.js";
import { Row, Stack } from "./flex.js";
import { PageHeader } from "./page.js";

const meta = { title: "ui / Page / PageHeader" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const relanceActions = (
  <Row gap={6}>
    <Button size="sm" icon={<Pause size={12} />}>
      Pause
    </Button>
    <Button size="sm" variant="primary" icon={<Play size={12} />}>
      Retry
    </Button>
  </Row>
);

export const TitleOnly: Story = {
  name: "title alone",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-sheet">
        <PageHeader title="Infrastructure" />
      </div>
    </Stack>
  ),
};

export const TitleSubtitle: Story = {
  name: "title + subtitle",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-sheet">
        <PageHeader
          title="Channels"
          sub="The project's live conversations — every task with a session reads its thread here."
        />
      </div>
    </Stack>
  ),
};

export const TitleActions: Story = {
  name: "title + actions",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-sheet">
        <PageHeader
          title="Infrastructure"
          actions={
            <IconBtn title="Refresh">
              <RefreshCw size={14} />
            </IconBtn>
          }
        />
      </div>
    </Stack>
  ),
};

export const TitleSubtitleActions: Story = {
  name: "title + subtitle + actions",
  render: () => (
    <Stack gap={10}>
      <div className="dsl-sheet">
        <PageHeader
          title="Stripe Checkout payment tunnel redesign"
          sub="Goal active since 2h14 · agent senior-dev · branch legion/checkout · $2.87 spent out of a $5.00 budget, and this sentence keeps going on purpose to show the prose stops at the reading measure instead of crossing the screen."
          actions={relanceActions}
        />
      </div>
    </Stack>
  ),
};

export const LongSubtitleNarrowScreen: Story = {
  name: "long subtitle, narrow screen",
  render: () => (
    // dsl-narrow simulates the point where the subtitle no longer fits beside the title: it must go
    // back below AND wrap to its reading measure, never overlap the actions.
    <Stack gap={10}>
      <div className="dsl-sheet dsl-narrow">
        <PageHeader
          title="Payment tunnel redesign"
          sub="Goal active since 2h14 · agent senior-dev · branch legion/checkout · $2.87 spent out of a $5.00 budget."
          actions={relanceActions}
        />
      </div>
    </Stack>
  ),
};
