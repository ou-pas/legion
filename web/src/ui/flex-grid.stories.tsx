// Columns as explicit variants (2/3/4/5), wrapping automatically: 5 columns become 3 under 1180 px
// (a kanban lane under 200 px truncates every name onto two lines), then all become 2 under 900 px
// and 1 under 560 px. `min` gives an auto-fit grid.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./card.js";
import { Grid, Stack } from "./flex.js";

const meta = { title: "ui / Grid" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Demo tile: what the grid holds in the product (dashboard numbers). */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="dsl-tile-label">{label}</div>
      <div className="dsl-tile-value">{value}</div>
    </Card>
  );
}

export const Cols5Board: Story = {
  name: "cols 5 — the board",
  render: () => (
    <Stack gap={10}>
      <Grid cols={5} gap={12}>
        <Tile label="Later" value="4" />
        <Tile label="Todo" value="3" />
        <Tile label="Doing" value="2" />
        <Tile label="Review" value="3" />
        <Tile label="Done" value="9" />
      </Grid>
    </Stack>
  ),
};

export const Cols4: Story = {
  name: "cols 4",
  render: () => (
    <Stack gap={10}>
      <Grid cols={4} gap={12}>
        <Tile label="Active sessions" value="3" />
        <Tile label="Gates waiting" value="1" />
        <Tile label="Today's cost" value="$2.87" />
        <Tile label="Goal budget" value="57%" />
      </Grid>
    </Stack>
  ),
};

export const Cols2: Story = {
  name: "cols 2",
  render: () => (
    <Stack gap={10}>
      <Grid cols={2} gap={12}>
        <Tile label="Tasks done" value="12" />
        <Tile label="Off-plan iterations" value="2" />
      </Grid>
    </Stack>
  ),
};

export const Min220: Story = {
  name: "min 220",
  render: () => (
    <Stack gap={10}>
      <Grid min={220} gap={12}>
        <Tile label="senior-dev" value="8 sessions" />
        <Tile label="spec" value="3 sessions" />
        <Tile label="reviewer" value="5 sessions" />
      </Grid>
    </Stack>
  ),
};
