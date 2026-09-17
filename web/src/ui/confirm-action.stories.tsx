// Two steps in place: the button becomes "Confirm?", a second action offers "Cancel", and the state
// resets by itself after a few seconds or on blur. The change is announced (aria-live). No modal:
// nothing here deserves an interruption.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skull, Trash2 } from "lucide-react";
import { userEvent } from "storybook/test";
import { ConfirmAction } from "./confirm-action.js";
import { Row } from "./flex.js";

const meta = { title: "ui / ConfirmAction" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

export const GoalKillSwitch: Story = {
  name: "kill switch on a goal",
  render: () => (
    <Row gap={10} wrap>
      <ConfirmAction
        label="Kill switch"
        confirmLabel="Confirm stop?"
        announce='Stopping goal "Harden the payment tunnel": confirm or cancel.'
        leading={<Skull size={13} />}
        onConfirm={noop}
      />
      <span className="dsf-quiet">Harden the payment tunnel — 1 session running</span>
    </Row>
  ),
};

export const RuleDeletionSm: Story = {
  name: "deleting a rule (sm)",
  render: () => (
    <Row gap={10} wrap>
      <ConfirmAction
        label="Delete the rule"
        size="sm"
        leading={<Trash2 size={13} />}
        confirmLabel="Delete?"
        onConfirm={noop}
      />
      <span className="dsf-quiet">stripe-payments.md — applied to 3 agents</span>
    </Row>
  ),
};

export const VariantDefaultCommonAction: Story = {
  name: "default variant (routine action)",
  render: () => (
    <Row gap={10} wrap>
      <ConfirmAction
        label="Destroy the container"
        variant="default"
        size="sm"
        confirmLabel="Destroy?"
        onConfirm={noop}
      />
    </Row>
  ),
};

export const Disabled: Story = {
  name: "disabled",
  render: () => (
    <Row gap={10} wrap>
      <ConfirmAction label="Kill switch" leading={<Skull size={13} />} disabled onConfirm={noop} />
      <span className="dsf-quiet">Cut front build time — goal already done</span>
    </Row>
  ),
};

export const CleanupInProgress: Story = {
  name: "cleanup in progress (loading — InfraPage's trash)",
  render: () => (
    <Row gap={10} wrap>
      <ConfirmAction
        label="Clean up 3 orphan(s)"
        leading={<Trash2 size={13} />}
        confirmLabel="Delete permanently?"
        loading
        disabled
        onConfirm={noop}
      />
      <span className="dsf-quiet">
        cleanup.isPending — the trash icon becomes a spinner, the button won't take a second click.
      </span>
    </Row>
  ),
};

export const IconOnlyTaskDeletion: Story = {
  name: "icon only at rest (deleting a task)",
  render: () => (
    <Row gap={10} wrap>
      <ConfirmAction
        variant="danger"
        iconOnly
        label="Delete"
        leading={<Trash2 size={13} />}
        confirmLabel="Delete the task?"
        onConfirm={noop}
      />
      <span className="dsf-quiet">
        First click: icon only (tooltip "Delete"), red and outlined like the stop button. The
        confirmation keeps its label.
      </span>
    </Row>
  ),
};

export const ArmedPrimaryVariant: Story = {
  name: "armed · primary",
  render: function Render() {
    return (
      <Row gap={10} wrap>
        <ConfirmAction
          variant="primary"
          label="Approve"
          confirmLabel="Confirm the approval?"
          onConfirm={noop}
        />
        <span className="dsf-quiet">
          Armed state: the button keeps its primary color (blue) with an accent outline. The icon
          stays the same since this isn't a danger variant.
        </span>
      </Row>
    );
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    if (button) {
      await userEvent.click(button);
    }
  },
};

export const ArmedDefaultVariant: Story = {
  name: "armed · default",
  render: function Render() {
    return (
      <Row gap={10} wrap>
        <ConfirmAction
          variant="default"
          label="Discuss first"
          confirmLabel="Start the interview?"
          onConfirm={noop}
        />
        <span className="dsf-quiet">
          Armed state: the button keeps its default color (gray) with an accent outline. The icon
          stays the same.
        </span>
      </Row>
    );
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    if (button) {
      await userEvent.click(button);
    }
  },
};

export const ArmedDangerVariant: Story = {
  name: "armed · danger",
  render: function Render() {
    return (
      <Row gap={10} wrap>
        <ConfirmAction
          variant="danger"
          label="Delete"
          leading={<Trash2 size={13} />}
          confirmLabel="Delete permanently?"
          onConfirm={noop}
        />
        <span className="dsf-quiet">
          Armed state: the button stays red with a red outline, and shows the warning triangle icon
          to flag the destructive action.
        </span>
      </Row>
    );
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector("button");
    if (button) {
      await userEvent.click(button);
    }
  },
};
