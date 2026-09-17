// Same accessibility contract as Modal, but it slides from the right edge: the detail is read
// without leaving the list.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "./button.js";
import { Drawer } from "./drawer.js";
import { Row, Spacer, Stack } from "./flex.js";

const TRACE = [
  ["09:14:02", "repo_ready", "front · ./repos/front · legion/checkout"],
  ["09:14:07", "tool_start", "Read /repos/front/src/checkout/PaymentForm.tsx"],
  ["09:14:11", "tool_end", "3 821 ms"],
  ["09:15:40", "repo_push", "front · 7 changements · 5f0be31"],
] as const;

const meta = { title: "ui / Drawer" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const OpenDrawer: Story = {
  name: "open",
  render: function Render() {
    const [surface, setSurface] = useState<"task" | "compose" | "drawer" | null>(null);
    const close = () => setSurface(null);
    return (
      <Row gap={10} wrap>
        <Button leading={<FileText size={13} />} onClick={() => setSurface("drawer")}>
          Session detail · senior-dev
        </Button>
        {surface === "drawer" && (
          <Drawer
            title="Session · senior-dev"
            onClose={close}
            footer={
              <>
                <span>claude-sonnet-5 · $0.11</span>
                <Spacer />
                <Button size="sm" variant="danger" leading={<Square size={12} />} onClick={close}>
                  Stop
                </Button>
              </>
            }
          >
            <Stack gap={12}>
              <dl className="dsn-def">
                <dt>Task</dt>
                <dd>Add search by order reference</dd>
                <dt>State</dt>
                <dd>running · limited network</dd>
                <dt>Branch</dt>
                <dd>legion/checkout</dd>
                <dt>Repo</dt>
                <dd>front · ./repos/front</dd>
              </dl>
              <div className="dsn-trace">
                {TRACE.map(([time, type, body]) => (
                  <div className="dsn-trace-row" key={time}>
                    <span className="dsn-trace-time">{time}</span>
                    <span className="dsn-trace-type">{type}</span>
                    <span className="dsn-trace-body">{body}</span>
                  </div>
                ))}
              </div>
            </Stack>
          </Drawer>
        )}
      </Row>
    );
  },
};
