import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Checkbox } from "./choice.js";
import { Stack } from "./flex.js";
import { Field, Fieldset, FormError, FormOk, FormRow } from "./form.js";
import { Input } from "./input.js";
import { Select } from "./select.js";

const meta = { title: "ui / Field · Fieldset · FormRow" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const AGENTS = ["senior-dev", "spec", "reviewer"];

export const HintError: Story = {
  name: "hint + error",
  render: () => (
    <Stack gap={10}>
      <Field
        label="Output folder"
        required
        hint="Absolute path on the host — not a path relative to the project."
        error="This folder isn't reachable from the container."
      >
        <Input value="/Users/operator/legion/out" onChange={() => {}} />
      </Field>
    </Stack>
  ),
};

export const ThreeFieldsOnOneRow: Story = {
  name: "three fields on one line",
  render: () => (
    <Stack gap={10}>
      <FormRow>
        <Field label="Agent">
          <Select value="senior-dev" onChange={() => {}}>
            {AGENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget $" hint="Stops automatically past this.">
          <Input value="12.50" onChange={() => {}} />
        </Field>
        <Field label="Max duration h">
          <Input value="2" onChange={() => {}} />
        </Field>
      </FormRow>
    </Stack>
  ),
};

export const FieldsetState: Story = {
  name: "fieldset",
  render: function Render() {
    const [injectReview, setInjectReview] = useState(false);
    const [notify, setNotify] = useState(true);
    return (
      <Stack gap={10}>
        <Fieldset legend="Rule scope" hint='An "all agents" rule applies to the whole project.'>
          <Checkbox checked={notify} onChange={setNotify}>
            All agents on the project
          </Checkbox>
          <Checkbox checked={injectReview} onChange={setInjectReview}>
            Also inject into review sessions
          </Checkbox>
        </Fieldset>
      </Stack>
    );
  },
};

export const Messages: Story = {
  name: "messages",
  render: () => (
    <Stack gap={10}>
      <FormError>The container refused the upload: .exe extension not allowed.</FormError>
      <FormOk>"stripe-payments" rule added — 3 agents updated.</FormOk>
    </Stack>
  ),
};
