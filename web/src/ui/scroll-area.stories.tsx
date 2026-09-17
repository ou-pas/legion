// Bounded height, contained overscroll, edge shadows computed on scroll: they only appear if there
// really is something beyond.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./card.js";
import { Stack } from "./flex.js";
import { ScrollArea } from "./scroll-area.js";

const meta = { title: "ui / ScrollArea" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const LOG: Array<[string, string, string]> = [
  ["14:02:11", "goal.plan", "Plan approved — 4 steps, agent senior-dev on legion/checkout"],
  ["14:02:48", "session.start", "container legion-sess-8f2a started on home-server"],
  ["14:03:12", "repo.clone", "acme/checkout-web → ./repos/checkout-web"],
  ["14:05:03", "tool.bash", "pnpm test --filter @legion/checkout"],
  ["14:06:41", "gate.request", "Change to src/payments/stripe.ts — approval requested"],
  ["14:09:02", "gate.approve", "Approved by the operator (2 min 21s delay)"],
  ["14:12:33", "artifact", "diff.patch · 214 lines added, 38 removed"],
  ["14:15:07", "cost", "$1.42 spent — goal budget $5.00"],
  ["14:18:55", "tool.bash", "pnpm exec playwright test payment-tunnel.spec.ts"],
  ["14:21:10", "task.done", "Stripe Checkout payment tunnel redesign — 3 tests green"],
  ["14:21:44", "session.commit", "commit 9c1f0ab pushed to legion/checkout"],
  ["14:22:02", "session.destroy", "container cleaned up, volumes removed"],
  ["14:31:18", "goal.step", "Step 3/4 — PDF export of monthly reports, agent spec"],
  ["14:33:40", "inbox.question", "Which font for the PDF header: Fraunces or Archivo?"],
  ["14:47:26", "inbox.answer", "Archivo — the header must stay readable at 8pt"],
  ["14:52:09", "tool.write", "server/src/reports/pdf.ts"],
  ["14:58:31", "cost", "$2.87 spent — 57% of the goal budget"],
];

export const MdOverflowShadowBottomThenTop: Story = {
  name: "md · overflows (shadow at bottom, then top)",
  render: () => (
    <Stack gap={10}>
      <Card pad={false}>
        <ScrollArea label="Orchestrator log">
          {LOG.map(([time, type, text]) => (
            <div key={time + type} className="dsl-log">
              <span className="dsl-log-time">{time}</span>
              <span className="dsl-log-type">{type}</span>
              <span className="dsl-log-text">{text}</span>
            </div>
          ))}
        </ScrollArea>
      </Card>
    </Stack>
  ),
};

export const SmOverflow: Story = {
  name: "sm · overflows",
  render: () => (
    <Stack gap={10}>
      <Card pad={false}>
        <ScrollArea size="sm" label="Short log">
          {LOG.slice(0, 8).map(([time, type, text]) => (
            <div key={time + type} className="dsl-log">
              <span className="dsl-log-time">{time}</span>
              <span className="dsl-log-type">{type}</span>
              <span className="dsl-log-text">{text}</span>
            </div>
          ))}
        </ScrollArea>
      </Card>
    </Stack>
  ),
};

export const NoOverflowNoShadow: Story = {
  name: "doesn't overflow · no shadow",
  render: () => (
    <Stack gap={10}>
      <Card pad={false}>
        <ScrollArea size="lg" label="Finished session log">
          {LOG.slice(9, 12).map(([time, type, text]) => (
            <div key={time + type} className="dsl-log">
              <span className="dsl-log-time">{time}</span>
              <span className="dsl-log-type">{type}</span>
              <span className="dsl-log-text">{text}</span>
            </div>
          ))}
        </ScrollArea>
      </Card>
    </Stack>
  ),
};

export const FillParentHeight: Story = {
  name: "fill — the pane takes whatever height the parent leaves it",
  render: () => (
    // The Channels view case: a fixed-height column, a header, the scrolling thread, and a footer
    // stuck at the bottom. A pixel `max-height` would have left a gap under the thread on a large
    // screen and pushed the footer out on a small one; `fill` settles both.
    <div className="dsl-fill-frame">
      <div className="dsl-fill-head">header, doesn't scroll</div>
      <ScrollArea size="fill" label="Conversation thread">
        {LOG.concat(LOG).map(([time, type, text], i) => (
          <div key={i} className="dsl-log">
            <span className="dsl-log-time">{time}</span>
            <span className="dsl-log-type">{type}</span>
            <span className="dsl-log-text">{text}</span>
          </div>
        ))}
      </ScrollArea>
      <div className="dsl-fill-foot">footer, stuck to the bottom</div>
    </div>
  ),
};
