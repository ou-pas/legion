// Focus trap (Tab does not leave), initial focus on the first field, focus returned to the trigger
// on close, Escape and backdrop click. The body scrolls, header and footer stay.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { GitPullRequest, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "./button.js";
import { Row, Spacer, Stack } from "./flex.js";
import { Field } from "./form.js";
import { Input, Textarea } from "./input.js";
import { Select } from "./select.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "./modal.js";

const meta = { title: "ui / Modal" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const OpenModal: Story = {
  name: "open",
  render: function Render() {
    const [surface, setSurface] = useState<"task" | "compose" | "drawer" | null>(null);
    const close = () => setSurface(null);
    const [title, setTitle] = useState("Fix the VAT calculation on EU orders");
    const [navAgent, setNavAgent] = useState("senior-dev");
    return (
      <Row gap={10} wrap>
        <Button variant="primary" leading={<Play size={13} />} onClick={() => setSurface("task")}>
          Run a task
        </Button>
        <Button onClick={() => setSurface("compose")}>Composed modal (lg)</Button>
        {surface === "task" && (
          <Modal
            title="Run a task"
            onClose={close}
            footer={
              <>
                <Button size="sm" variant="quiet" onClick={close}>
                  Cancel
                </Button>
                <Spacer />
                <Button size="sm" variant="primary" leading={<Play size={12} />} onClick={close}>
                  Run
                </Button>
              </>
            }
          >
            <Stack gap={12}>
              <Field label="Title" required>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field
                label="Agent"
                hint="The model follows the agent, unless a step override applies."
              >
                <Select value={navAgent} onChange={(e) => setNavAgent(e.target.value)}>
                  <option value="senior-dev">senior-dev — implements and fixes</option>
                  <option value="spec">spec — writes approvable specs</option>
                  <option value="writer">writer — isolated writer, limited network</option>
                </Select>
              </Field>
              <Field label="Context" hint="What the agent needs to know before starting.">
                <Textarea
                  rows={3}
                  value="EU VAT: the rate of the delivery country, not the HQ's."
                  onChange={() => {}}
                />
              </Field>
            </Stack>
          </Modal>
        )}
        {surface === "compose" && (
          <Modal onClose={close} size="lg">
            <ModalHeader icon={<GitPullRequest size={15} />}>
              Stripe Checkout payment tunnel redesign
            </ModalHeader>
            <ModalBody>
              <Stack gap={8}>
                <p>
                  PR draft written by senior-dev on <code>legion/checkout</code>.
                </p>
                <div className="dsn-pane">
                  7 files changed · 5f0be31 · approval gate waiting for 2h.
                </div>
                <p>The modal body scrolls; the header and footer stay in place.</p>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <span>Session cost: $2.87</span>
              <Spacer />
              <Button size="sm" variant="quiet" onClick={close}>
                Close
              </Button>
              <Button size="sm" variant="primary" onClick={close}>
                Approve the PR
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </Row>
    );
  },
};
