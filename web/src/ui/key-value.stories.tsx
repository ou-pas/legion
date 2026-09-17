// A real <dl>: the key/value relation exists in the HTML, and all values align on a common column
// without a guessed width.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./chip.js";
import { Stack } from "./flex.js";
import { KeyValue, KeyValueList } from "./key-value.js";
import { Num } from "./num.js";

const meta = { title: "ui / KeyValue · KeyValueList" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AlignedDefault: Story = {
  name: "aligned (default)",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet dsd-pad">
        <KeyValueList label="Session metadata">
          <KeyValue label="Agent">senior-dev</KeyValue>
          <KeyValue label="Model">
            <Tag>claude-sonnet-5</Tag>
          </KeyValue>
          <KeyValue label="Runner" hint="local docker">
            local-docker
          </KeyValue>
          <KeyValue label="Branch">
            <Tag>legion/checkout</Tag>
          </KeyValue>
          <KeyValue label="Cost">
            <Num value="2.87" prefix="$" />
          </KeyValue>
          <KeyValue label="Network">limited — api.stripe.com, registry.npmjs.org</KeyValue>
        </KeyValueList>
      </div>
    </Stack>
  ),
};

export const StackedCompactRailColumn: Story = {
  name: "stacked + compact — rail column",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-narrow dsd-sheet dsd-pad">
        <KeyValueList variant="stacked" density="compact" label="Goal guardrails">
          <KeyValue label="Budget">
            <Num value="6.42" prefix="$" /> / <Num value="25.00" prefix="$" />
          </KeyValue>
          <KeyValue label="Max duration">2h</KeyValue>
          <KeyValue label="Allowed agents">senior-dev, review-coordinator</KeyValue>
        </KeyValueList>
      </div>
    </Stack>
  ),
};
