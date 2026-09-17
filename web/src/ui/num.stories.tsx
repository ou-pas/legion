// Tabular digits, unit separated by a narrow no-break space, true minus sign (U+2212) on deltas.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row, Stack } from "./flex.js";
import { Num } from "./num.js";

const meta = { title: "ui / Num" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const PrefixSuffix: Story = {
  name: "prefix / suffix",
  render: () => (
    <Row gap={10} wrap>
      <Num value="2.87" prefix="$" />
      <Num value={72} suffix="%" />
      <Num value={3821} suffix="ms" />
    </Row>
  ),
};

export const Tones: Story = {
  name: "tones",
  render: () => (
    <Row gap={10} wrap>
      <Num value="0.0041" prefix="$" tone="muted" />
      <Num value={94} suffix="%" tone="wait" />
      <Num value={3} suffix="failures" tone="bad" />
    </Row>
  ),
};

export const Delta: Story = {
  name: "delta",
  render: () => (
    <Row gap={10} wrap>
      <Num value={42} variant="delta" />
      <Num value={-18} variant="delta" />
      <Num value={0} variant="delta" />
      <Num value="0.42" variant="delta" prefix="$" tone="bad" />
    </Row>
  ),
};

export const AlignEnd: Story = {
  name: "align=end",
  render: () => (
    <Stack gap={10}>
      <div className="ds-tp-numcol">
        <Num value={3821} suffix="ms" align="end" />
        <Num value={94} suffix="ms" align="end" />
        <Num value={128005} suffix="ms" align="end" />
      </div>
    </Stack>
  ),
};
