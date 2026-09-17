// Four objects, three silhouettes: a state is a pill with a dot, a datum a mono rectangle, a count
// a token. They must not blur from a distance.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SESSION_CHIP } from "../sessions/session-status.js";
import { SESSION_TEXT } from "../sessions/text.js";
import { Badge, Chip, StatusChip, Tag } from "./chip.js";
import { Row } from "./flex.js";

const meta = { title: "ui / StatusChip · Chip · Tag · Badge" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const EVENTS = ["tool_start", "fs_denied", "repo_push", "throttle"];

export const StatusChipDomainStates: Story = {
  name: "StatusChip — domain states",
  render: () => {
    return (
      <Row gap={10} wrap>
        <StatusChip state="run">running</StatusChip>
        <StatusChip state="wait">waiting for your answer</StatusChip>
        <StatusChip state="gate">needs approval</StatusChip>
        <StatusChip state="ok">done</StatusChip>
        <StatusChip state="bad">failed</StatusChip>
        <StatusChip state="idle">draft</StatusChip>
      </Row>
    );
  },
};

export const StatusChipWithoutDotSizeSm: Story = {
  name: "StatusChip — no dot, size sm",
  render: () => {
    return (
      <Row gap={10} wrap>
        <StatusChip state="run" dot={false}>
          running
        </StatusChip>
        <StatusChip state="gate" size="sm">
          gate
        </StatusChip>
        <StatusChip state="ok" size="sm" dot={false}>
          DoD met
        </StatusChip>
      </Row>
    );
  },
};

export const ChipNeutralAndSessionChipCompat: Story = {
  name: "Chip — neutral and SESSION_CHIP-compatible",
  render: () => (
    <Row gap={10} wrap>
      <Chip>senior-dev</Chip>
      <Chip>2 comments</Chip>
      <Chip kind={SESSION_CHIP.running} dot>
        {SESSION_TEXT.status.running}
      </Chip>
      <Chip kind={SESSION_CHIP.destroyed} dot>
        {SESSION_TEXT.status.destroyed}
      </Chip>
      <Chip kind="st-wait" mono>
        step 3
      </Chip>
    </Row>
  ),
};

export const ChipTwoStateFilterToggle: Story = {
  name: "Chip — two-state filter (onToggle)",
  render: function Render() {
    const [picked, setPicked] = useState<string[]>(["tool_start", "fs_denied"]);
    return (
      <Row gap={10} wrap>
        {EVENTS.map((e) => (
          <Chip
            key={e}
            mono
            selected={picked.includes(e)}
            onToggle={() =>
              setPicked((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]))
            }
          >
            {e}
          </Chip>
        ))}
      </Row>
    );
  },
};

export const TagLiteralDatum: Story = {
  name: "Tag — a literal value",
  render: () => {
    return (
      <Row gap={10} wrap>
        <Tag>claude-sonnet-5</Tag>
        <Tag>legion/checkout</Tag>
        <Tag>5f0be31</Tag>
        <Tag title="/repos/front/src/checkout/PaymentForm.tsx">
          /repos/front/src/checkout/PaymentForm.tsx
        </Tag>
      </Row>
    );
  },
};

export const TagFlat: Story = {
  name: "Flat tag — what informs beside what clicks",
  render: () => (
    <Row gap={10} wrap>
      <Tag variant="flat">GitLab</Tag>
      <Tag variant="flat">private</Tag>
      <Tag>GitLab</Tag>
      <Tag>private</Tag>
    </Row>
  ),
};

export const BadgeCounter: Story = {
  name: "Badge — a counter",
  render: () => (
    <Row gap={10} wrap>
      <Badge count={2} tone="wait" label="2 questions waiting" />
      <Badge count={7} tone="accent" />
      <Badge count={12} />
      <Badge count={128} tone="bad" />
    </Row>
  ),
};
