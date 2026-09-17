// THE app's only tooltip mechanism. Hover AND focus (Tab to the examples), configurable open delay
// (140ms by default), none on close, Escape closes. Preferred side configurable, flipping to the
// opposite when space runs out. The child receives aria-describedby, so it must accept ARIA
// attributes: IconBtn, Tag, Chip and StatusChip all do internally (their `title` is not the native
// attribute, invisible for ~1s and absent on keyboard, but the text of THIS bubble).

import type { Meta, StoryObj } from "@storybook/react-vite";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "./button.js";
import { Code } from "./code.js";
import { Row, Stack } from "./flex.js";
import { Tooltip } from "./tooltip.js";

const meta = { title: "ui / Tooltip" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AtRestHoverOrTab: Story = {
  name: "at rest (hover or Tab to open)",
  render: () => (
    <Row gap={10} wrap>
      <Tooltip label="Retry the session with a diagnostic">
        <Button aria-label="Retry the session" leading={<RotateCcw size={14} />} />
      </Tooltip>
    </Row>
  ),
};

export const OpenPinnedForCapture: Story = {
  name: "open (pinned for the capture)",
  render: () => (
    <Row gap={10} wrap>
      <div className="dsf-tip-static">
        <Button aria-label="Retry the session" leading={<RotateCcw size={14} />} />
        <div
          className="ui-tooltip dsf-tip-static-bubble"
          data-side="bottom"
          data-ready="true"
          role="tooltip"
        >
          Retry the session with a diagnostic
        </div>
      </div>
    </Row>
  ),
};

export const OnDisabledControl: Story = {
  name: "on a disabled control",
  render: () => (
    <Row gap={10} wrap>
      <Tooltip label="No event to copy yet — wait for the session to produce one">
        <Button leading={<Trash2 size={14} />} disabled>
          Copy the trace
        </Button>
      </Tooltip>
      <span className="dsf-quiet">
        hover or Tab (the button can't receive focus itself: it's the WRAPPER that listens and
        carries it)
      </span>
    </Row>
  ),
};

export const LongText: Story = {
  name: "long text",
  render: () => (
    <Row gap={10} wrap>
      <Tooltip label={"Granted folders:\n/repos/front\n/artifacts\n/agents/spec"}>
        <Button size="sm">senior-dev's permissions</Button>
      </Tooltip>
    </Row>
  ),
};

export const AnchoredAtWindowEdge: Story = {
  name: "anchor at the window edge (recentering)",
  render: () => (
    <Stack gap={10}>
      <div className="dsf-edge">
        <Tooltip label="Cumulative cost of the 8 sessions in the Demo (mock) project: $6.77">
          <Button size="sm">$6.77</Button>
        </Tooltip>
      </div>
    </Stack>
  ),
};

export const PreferredSide: Story = {
  name: "preferred side (side)",
  render: () => (
    <Row gap={10} wrap>
      <Tooltip label="Pin the task" side="top">
        <Button size="sm">top</Button>
      </Tooltip>
      <Tooltip label="Pin the task" side="bottom">
        <Button size="sm">bottom</Button>
      </Tooltip>
      <Tooltip label="Pin the task" side="left">
        <Button size="sm">left</Button>
      </Tooltip>
      <Tooltip label="Pin the task" side="right">
        <Button size="sm">right</Button>
      </Tooltip>
    </Row>
  ),
};

export const AnchoredInDenseListSideRight: Story = {
  name: "anchor in a dense list (side=right)",
  render: () => (
    <Stack gap={10}>
      <p className="dsf-quiet">
        30px rows: a top/bottom side sticks the bubble against the neighboring row and covers it — a
        bug observed on a task's timeline (hundreds of rows of this kind). `side="right"` pushes it
        aside instead of on top.
      </p>
      <div className="dsf-dense">
        <div className="dsf-dense-row">
          write{" "}
          <Tooltip label="/repos/front/src/checkout/PaymentForm.tsx" side="right">
            <Code>PaymentForm.tsx</Code>
          </Tooltip>
        </div>
        <div className="dsf-dense-row">
          read{" "}
          <Tooltip label="/repos/front/src/checkout/stripe.ts" side="right">
            <Code>stripe.ts</Code>
          </Tooltip>
        </div>
        <div className="dsf-dense-row">
          write{" "}
          <Tooltip label="/repos/front/package.json" side="right">
            <Code>package.json</Code>
          </Tooltip>
        </div>
      </div>
    </Stack>
  ),
};
