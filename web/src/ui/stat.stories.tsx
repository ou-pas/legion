// The "big number + small label" tile grid is banned as page structure: the default variant is
// inline, a measure in an instrument bar.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row, Stack } from "./flex.js";
import { Num } from "./num.js";
import { Stat, StatGroup } from "./stat.js";

const meta = { title: "ui / Stat · StatGroup" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const InlineDefaultMeasureBar: Story = {
  name: "inline variant (default) — instrument bar",
  render: () => (
    <Stack gap={10}>
      <StatGroup label="Demo project state">
        <Stat label="Active sessions" value={3} hint="out of 8 total" />
        <Stat
          label="Today's cost"
          value="6.77"
          prefix="$"
          trend={<Num variant="delta" value={-0.42} prefix="$" tone="ok" />}
        />
        <Stat label="Waiting for you" value={2} tone="wait" hint="2 inbox questions" />
        <Stat label="In review" value={4} hint="1 of which has comments" />
      </StatGroup>
    </Stack>
  ),
};

export const TileInCardWithoutOwnSurface: Story = {
  name: "tile variant — inside a card, no surface of its own",
  render: () => (
    <Stack gap={10}>
      <div className="dsd-sheet dsd-pad">
        <StatGroup variant="tile" label="Demo project costs">
          <Stat variant="tile" label="Total cost" value="6.77" prefix="$" hint="8 sessions" />
          <Stat
            variant="tile"
            label="Most expensive session"
            value="2.87"
            prefix="$"
            hint="Stripe tunnel redesign"
          />
          <Stat
            variant="tile"
            label="Tasks done"
            value={3}
            trend={<Num variant="delta" value={2} />}
            hint="out of 12"
          />
        </StatGroup>
      </div>
    </Stack>
  ),
};

export const SingleMeasureOutsideGroup: Story = {
  name: "a single measure, outside a group",
  render: () => (
    <Row gap={10} wrap>
      <Stat label="Goal iterations" value={4} hint="beyond the plan" tone="wait" />
    </Row>
  ),
};
