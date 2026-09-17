// Opacity pulse only, no shiny sweep. Shapes are aria-hidden; the block carries aria-busy and the
// label of what is loading.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row, Stack } from "./flex.js";
import { Panel, PanelHeader } from "./panel.js";
import { Skeleton, SkeletonText } from "./skeleton.js";

const meta = { title: "ui / Skeleton · SkeletonText" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Shapes: Story = {
  name: "shapes",
  render: () => (
    <Row gap={10} wrap>
      <Skeleton shape="circle" />
      <Skeleton shape="chip" width="md" />
      <Skeleton shape="text" width="lg" />
    </Row>
  ),
};

export const Paragraph3Lines: Story = {
  name: "paragraph (3 lines)",
  render: () => (
    <Stack gap={10}>
      <SkeletonText lines={3} label="Loading the goal's plan…" />
    </Stack>
  ),
};

export const ShortParagraph2Lines: Story = {
  name: "short paragraph (2 lines)",
  render: () => (
    <Stack gap={10}>
      <SkeletonText lines={2} width="lg" label="Loading the task description…" />
    </Stack>
  ),
};

export const ArtifactPreviewBlock: Story = {
  name: "block (artifact preview)",
  render: () => (
    <Stack gap={10}>
      <Skeleton shape="block" />
    </Stack>
  ),
};

export const PendingSessionRegistry: Story = {
  name: "pending sessions register",
  render: () => {
    return (
      <Stack gap={10}>
        <Panel>
          <PanelHeader title="Sessions" />
          <div className="dsf-skel-row">
            <Skeleton shape="circle" />
            <div className="dsf-skel-grow">
              <SkeletonText lines={2} label="Loading the project's sessions…" />
            </div>
            <Skeleton shape="chip" width="sm" />
          </div>
          <div className="dsf-skel-row">
            <Skeleton shape="circle" />
            <div className="dsf-skel-grow">
              <SkeletonText lines={2} width="lg" label="Loading the project's sessions…" />
            </div>
            <Skeleton shape="chip" width="sm" />
          </div>
        </Panel>
      </Stack>
    );
  },
};
