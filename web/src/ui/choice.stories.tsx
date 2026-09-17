// The label is part of the target: 24px tall minimum, no dead zone.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Checkbox, Radio, RadioGroup, Switch } from "./choice.js";
import { Row, Stack } from "./flex.js";

const meta = { title: "ui / Checkbox · Radio · Switch" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

export const Checkboxes: Story = {
  name: "cases",
  render: function Render() {
    const [gate, setGate] = useState(true);
    const [runNow, setRunNow] = useState(false);
    return (
      <Row gap={10} wrap>
        <Checkbox checked={gate} onChange={setGate}>
          Approval gate
        </Checkbox>
        <Checkbox checked={runNow} onChange={setRunNow}>
          Run now
        </Checkbox>
        <Checkbox checked disabled onChange={noop}>
          Artifacts required
        </Checkbox>
      </Row>
    );
  },
};

export const Radios: Story = {
  name: "radios",
  render: function Render() {
    const [level, setLevel] = useState("med");
    return (
      <Stack gap={10}>
        <RadioGroup label="Complexity" name="ds-complexity" value={level} onChange={setLevel}>
          <Radio value="low">low — haiku</Radio>
          <Radio value="med">medium — sonnet</Radio>
          <Radio value="high">high — opus</Radio>
        </RadioGroup>
      </Stack>
    );
  },
};

export const RadiosWithoutAnswer: Story = {
  name: "radios — no answer given yet",
  render: function Render() {
    // The missing state that let the defect through: the "radios" story starts on a value, so the
    // EMPTY group showed nowhere. A radio with no checked sibling is `:indeterminate` in HTML, and
    // the checkbox partial-state rule painted it in accent: three filled dots before any click
    // (spotted by the operator on an inbox form, not in the workshop).
    const [choix, setChoix] = useState("");
    return (
      <Stack gap={10}>
        <RadioGroup
          label="Starting point of a discussion"
          name="ds-vide"
          value={choix}
          onChange={setChoix}
        >
          <Radio value="composer">From the composer</Radio>
          <Radio value="tache">From an existing task</Radio>
          <Radio value="deux">Both</Radio>
        </RadioGroup>
      </Stack>
    );
  },
};

export const SwitchOnOff: Story = {
  name: "switch on / off",
  render: function Render() {
    const [autoMerge, setAutoMerge] = useState(false);
    const [notify, setNotify] = useState(true);
    return (
      <Row gap={10} wrap>
        <Switch checked={notify} onChange={setNotify}>
          Discord notifications
        </Switch>
        <Switch checked={autoMerge} onChange={setAutoMerge}>
          Auto merge
        </Switch>
        <Switch checked={false} disabled onChange={noop}>
          Multi-host Docker
        </Switch>
      </Row>
    );
  },
};
