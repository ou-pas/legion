// A bounded stack bottom right: 3 visible, the rest as a count. The timer pauses on hover and
// focus, closing by hand is always possible. The buttons below fire real notifications.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Play, RotateCcw, Skull } from "lucide-react";
import { Button } from "./button.js";
import { Row } from "./flex.js";
import { Toast, useToast } from "./toast.js";

const meta = { title: "ui / Toast · ToastProvider · useToast" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Must live UNDER the provider to call useToast(). */
function ToastTriggers() {
  const { push } = useToast();
  return (
    <>
      <Button
        variant="primary"
        leading={<Play size={13} />}
        onClick={() =>
          push({
            tone: "ok",
            title: "Session finished",
            body: "senior-dev pushed 7 files to legion/checkout — commit 5f0be31.",
            action: <Button size="sm">View the diff</Button>,
          })
        }
      >
        Success
      </Button>
      <Button
        onClick={() =>
          push({
            tone: "wait",
            title: "spec is waiting for your answer",
            body: "Delivery notifications: SMS too, or email only for v1?",
            action: <Button size="sm">Open the inbox</Button>,
          })
        }
      >
        Waiting
      </Button>
      <Button
        onClick={() =>
          push({ tone: "info", title: "Goal budget at 57%", body: "$2.87 of $5.00 spent." })
        }
      >
        Information
      </Button>
      <Button
        variant="danger"
        leading={<Skull size={13} />}
        onClick={() =>
          push({
            tone: "bad",
            title: "Session failed",
            body: RUN_ERROR,
            duration: 10_000,
          })
        }
      >
        Failed
      </Button>
      <Button
        variant="quiet"
        onClick={() => {
          for (const [i, agent] of [
            "senior-dev",
            "spec",
            "review-coordinator",
            "writer",
            "senior-dev",
          ].entries()) {
            push({
              tone: "info",
              title: `Container ${agent} started`,
              body: `legion-sess-8f2a${i} on home-server`,
            });
          }
        }}
      >
        Stack 5 (capped at 3)
      </Button>
    </>
  );
}

const noop = () => {};

const RUN_ERROR = "Timeout after 600s — heap out of memory at 512 invoices";

export const FireReal: Story = {
  name: "trigger (real)",
  render: () => (
    <Row gap={10} wrap>
      <ToastTriggers />
    </Row>
  ),
};

export const ToneInfoFrozen: Story = {
  name: "info tone (frozen)",
  render: () => {
    return (
      <Row gap={10} wrap>
        <Toast title="Goal budget at 57%" onClose={noop}>
          $2.87 of $5.00 spent.
        </Toast>
      </Row>
    );
  },
};

export const ToneOkActionFrozen: Story = {
  name: "ok tone + action (frozen)",
  render: () => {
    return (
      <Row gap={10} wrap>
        <Toast
          tone="ok"
          title="Session finished"
          onClose={noop}
          action={<Button size="sm">View the diff</Button>}
        >
          senior-dev pushed 7 files to legion/checkout — commit 5f0be31.
        </Toast>
      </Row>
    );
  },
};

export const ToneWaitFrozen: Story = {
  name: "wait tone (frozen)",
  render: () => {
    return (
      <Row gap={10} wrap>
        <Toast tone="wait" title="spec is waiting for your answer" onClose={noop}>
          Delivery notifications: SMS too, or email only for v1?
        </Toast>
      </Row>
    );
  },
};

export const ToneBadLongTextFrozen: Story = {
  name: "bad tone, long text (frozen)",
  render: () => {
    return (
      <Row gap={10} wrap>
        <Toast
          tone="bad"
          title="Session failed"
          onClose={noop}
          action={
            <Button size="sm" leading={<RotateCcw size={13} />}>
              Retry
            </Button>
          }
        >
          {RUN_ERROR}
        </Toast>
      </Row>
    );
  },
};
