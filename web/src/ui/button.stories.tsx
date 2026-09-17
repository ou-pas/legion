import type { Meta, StoryObj } from "@storybook/react-vite";
import { GitMerge, MessageSquare, Play, Plus, Skull } from "lucide-react";
import { Button } from "./button.js";
import { Row, Stack } from "./flex.js";
import { SubmitShortcut } from "./submit-shortcut.js";

const meta = { title: "ui / Button" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  name: "primary",
  render: () => (
    <Row gap={10} wrap>
      <Button variant="primary" leading={<Play size={13} />}>
        Run
      </Button>
      <Button variant="primary" size="sm" leading={<Play size={12} />}>
        Run
      </Button>
    </Row>
  ),
};

export const Default: Story = {
  name: "default",
  render: () => (
    <Row gap={10} wrap>
      <Button leading={<MessageSquare size={13} />}>Request changes</Button>
      <Button size="sm" leading={<MessageSquare size={12} />}>
        Request changes
      </Button>
    </Row>
  ),
};

export const Quiet: Story = {
  name: "quiet",
  render: () => (
    <Row gap={10} wrap>
      <Button variant="quiet">Cancel</Button>
      <Button variant="quiet" size="sm">
        Cancel
      </Button>
    </Row>
  ),
};

export const Danger: Story = {
  name: "danger",
  render: () => (
    <Row gap={10} wrap>
      <Button variant="danger" leading={<Skull size={13} />}>
        Kill switch
      </Button>
      <Button variant="danger" size="sm" leading={<Skull size={12} />}>
        Kill switch
      </Button>
    </Row>
  ),
};

export const SlotsLeadingTrailing: Story = {
  name: "slots leading / trailing",
  render: () => (
    <Row gap={10} wrap>
      <Button variant="primary" leading={<GitMerge size={13} />} trailing={<Play size={13} />}>
        Approve and merge
      </Button>
    </Row>
  ),
};

export const LoadingVsDisabled: Story = {
  name: "loading vs disabled",
  render: () => (
    <Row gap={10} wrap>
      <Button variant="primary" loading>
        Run
      </Button>
      <Button variant="primary" disabled>
        Run
      </Button>
      <Button loading>Approve and merge</Button>
      <Button disabled>Approve and merge</Button>
    </Row>
  ),
};

export const FullWidth: Story = {
  name: "full width",
  render: () => (
    <Stack gap={10}>
      <Button variant="primary" full leading={<Plus size={13} />}>
        Add a rule
      </Button>
    </Stack>
  ),
};

export const WithShortcut: Story = {
  name: "with shortcut — Kbd sits on the button (D2), never as a caption beside it",
  render: () => (
    <Row gap={10} wrap>
      <Button variant="primary" leading={<Play size={13} />} shortcut={<SubmitShortcut />}>
        Run
      </Button>
      <Button shortcut={<SubmitShortcut />}>Save</Button>
      <Button variant="primary" disabled shortcut={<SubmitShortcut />}>
        Save
      </Button>
      <Button variant="primary" loading shortcut={<SubmitShortcut />}>
        Save
      </Button>
    </Row>
  ),
};
