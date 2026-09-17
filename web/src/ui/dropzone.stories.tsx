// Five states: default, hover (with the mouse, on the first zone), file over, dropping, refused.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { type DragEvent } from "react";
import { Dropzone, FileChip } from "./dropzone.js";
import { Row, Stack } from "./flex.js";

const meta = { title: "ui / Dropzone · FileChip" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

const hold = (e: DragEvent) => e.preventDefault();

export const DefaultHover: Story = {
  name: "default + hover",
  render: () => (
    <Stack gap={10}>
      <Dropzone
        label="Drop .md files here — or click to choose"
        hint="One file = one rule. Re-dropping the same name updates it."
        onDragOver={hold}
        onDragLeave={noop}
        onDrop={hold}
        onClick={noop}
      />
    </Stack>
  ),
};

export const FileOver: Story = {
  name: "file over (over)",
  render: () => (
    <Stack gap={10}>
      <Dropzone
        over
        label="Drop to add 3 rules to the acme project"
        onDragOver={hold}
        onDragLeave={noop}
        onDrop={hold}
        onClick={noop}
      />
    </Stack>
  ),
};

export const DroppingBusy: Story = {
  name: "drop in progress (busy)",
  render: () => (
    <Stack gap={10}>
      <Dropzone
        busy
        label="Drop .md files here"
        onDragOver={hold}
        onDragLeave={noop}
        onDrop={hold}
        onClick={noop}
      />
    </Stack>
  ),
};

export const Rejected: Story = {
  name: "rejected",
  render: () => (
    <Stack gap={10}>
      <Dropzone
        rejected
        label="Extension rejected: .docx — only .md and .mdc are accepted"
        onDragOver={hold}
        onDragLeave={noop}
        onDrop={hold}
        onClick={noop}
      />
    </Stack>
  ),
};

export const Disabled: Story = {
  name: "disabled",
  render: () => (
    <Stack gap={10}>
      <Dropzone
        disabled
        label="Select a project to drop rules"
        onDragOver={hold}
        onDragLeave={noop}
        onDrop={hold}
        onClick={noop}
      />
    </Stack>
  ),
};

export const AcceptedFiles: Story = {
  name: "accepted files",
  render: () => (
    <Row gap={10} wrap>
      <FileChip name="stripe-payments-security-rule.md" bytes={4820} onRemove={noop} />
      <FileChip name="dod.md" bytes={612} onRemove={noop} />
      <FileChip name="trace-session.jsonl" bytes={2_310_144} />
    </Row>
  ),
};
