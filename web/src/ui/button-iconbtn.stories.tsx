// An accessible name through `title` is mandatory; it is also the text of its Tooltip
// (ui/tooltip.tsx), the app's only tooltip mechanism. It stays usable when disabled: Tab stops on
// the wrapper and hover still opens it, exactly where a native `title` would stay silent.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Ban, GitMerge, Play, Trash2 } from "lucide-react";
import { IconBtn } from "./button.js";
import { Row } from "./flex.js";
import { Text } from "./text.js";

const meta = { title: "ui / IconBtn" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

export const MdSmDanger: Story = {
  name: "md / sm / danger",
  render: () => {
    return (
      <Row gap={10} wrap>
        <IconBtn title="Retry the session" onClick={noop}>
          <Play size={14} />
        </IconBtn>
        <IconBtn title="Retry the session" size="sm" onClick={noop}>
          <Play size={13} />
        </IconBtn>
        <IconBtn title="Delete the rule" danger onClick={noop}>
          <Ban size={14} />
        </IconBtn>
      </Row>
    );
  },
};

export const DisabledWithReason: Story = {
  name: "disabled, with its reason (hover or Tab)",
  render: () => {
    return (
      <Row gap={10} wrap>
        <IconBtn title="Merge (protected branch)" disabled onClick={noop}>
          <GitMerge size={14} />
        </IconBtn>
      </Row>
    );
  },
};

export const InProgress: Story = {
  name: "loading — explicit loading, danger included",
  render: () => {
    return (
      <Row gap={10} wrap>
        <IconBtn title="Retry the session" loading onClick={noop}>
          <Play size={14} />
        </IconBtn>
        <IconBtn title="Retry the session" size="sm" loading onClick={noop}>
          <Play size={13} />
        </IconBtn>
        <IconBtn title="Delete the rule" danger loading onClick={noop}>
          <Ban size={14} />
        </IconBtn>
      </Row>
    );
  },
};

export const PromiseTrackedAutomatically: Story = {
  name: "onClick returns its promise — the spinner stops on its own, success or failure",
  render: function Render() {
    const [count, setCount] = useState(0);
    const [fails, setFails] = useState(0);
    return (
      <Row gap={16} wrap align="center">
        <IconBtn
          title="1.2s action that succeeds"
          onClick={() =>
            new Promise((resolve) => setTimeout(resolve, 1200)).then(() => setCount((c) => c + 1))
          }
        >
          <Play size={14} />
        </IconBtn>
        <Text size="sm" tone="muted">
          succeeded {count} times
        </Text>
        <IconBtn
          title="1.2s action that fails"
          danger
          onClick={() =>
            new Promise((_, reject) => setTimeout(reject, 1200)).catch(() => setFails((f) => f + 1))
          }
        >
          <Trash2 size={14} />
        </IconBtn>
        <Text size="sm" tone="muted">
          failed {fails} times — the spinner stops the same way
        </Text>
      </Row>
    );
  },
};

export const Side: Story = {
  name: "side",
  render: () => {
    return (
      <Row gap={10} wrap>
        <IconBtn title="Retry the session" side="left" onClick={noop}>
          <Play size={14} />
        </IconBtn>
      </Row>
    );
  },
};
