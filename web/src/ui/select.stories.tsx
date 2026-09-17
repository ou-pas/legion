// The "very long label" story is the visual proof of the open list's width bound: without it an
// open list grew off screen (measured: 393px in a 375px window).
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./form.js";
import { Stack } from "./flex.js";
import { Select } from "./select.js";
import { Text } from "./text.js";

const meta = { title: "ui / Select" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ValeurChoisie: Story = {
  name: "chosen value",
  render: function Render() {
    const [value, setValue] = useState("md");
    return (
      <Stack gap={10}>
        <Field label="Model">
          <Select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="sm">Fast</option>
            <option value="md">Balanced</option>
            <option value="lg">Thorough</option>
          </Select>
        </Field>
        <Text tone="muted" size="sm">
          Value: {value}
        </Text>
      </Stack>
    );
  },
};

export const Placeholder: Story = {
  name: "placeholder (no value matches)",
  render: function Render() {
    const [value, setValue] = useState("");
    return (
      <Field label="Time zone">
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="paris">Paris</option>
          <option value="tokyo">Tokyo</option>
        </Select>
      </Field>
    );
  },
};

export const Groupes: Story = {
  name: "groupes (optgroup)",
  render: function Render() {
    const [value, setValue] = useState("front");
    return (
      <Field label="Executor">
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <optgroup label="Agents">
            <option value="front">front</option>
            <option value="back">back</option>
          </optgroup>
          <optgroup label="Chains">
            <option value="feature">Full feature</option>
            <option value="fix">Targeted fix</option>
          </optgroup>
        </Select>
      </Field>
    );
  },
};

export const LibelleTresLong: Story = {
  name: "very long label (wraps to two lines, then ellipsis)",
  render: function Render() {
    const [value, setValue] = useState("c-1");
    return (
      <Field
        label="Channel"
        hint="A title longer than two lines gets an ellipsis, never cut on the first line: the title
          is what tells two channels apart."
      >
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="c-1">Move the front-end tests to Vitest</option>
          <option value="c-2">
            Rebuild the whole Stripe Checkout payment funnel with partial refunds and card dispute
            handling
          </option>
          <option value="c-3">
            Fix the Stripe webhook that duplicated orders placed between 10pm and midnight during
            scheduled maintenance
          </option>
          <option value="c-4">Clean up the build warnings</option>
        </Select>
      </Field>
    );
  },
};

export const OptionDesactivee: Story = {
  name: "disabled option, and disabled control",
  render: function Render() {
    const [value, setValue] = useState("md");
    return (
      <Stack gap={10}>
        <Field label="Model">
          <Select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="sm">Fast</option>
            <option value="md">Balanced</option>
            <option value="lg" disabled>
              Thorough (unavailable on this project)
            </option>
          </Select>
        </Field>
        <Field label="Disabled">
          <Select value={value} onChange={(e) => setValue(e.target.value)} disabled>
            <option value="md">Balanced</option>
          </Select>
        </Field>
      </Stack>
    );
  },
};

export const Tailles: Story = {
  name: "sizes",
  render: function Render() {
    const [value, setValue] = useState("md");
    return (
      <Stack gap={10}>
        <Field label="Size md">
          <Select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="md">Balanced</option>
          </Select>
        </Field>
        <Field label="Size sm">
          <Select size="sm" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="md">Balanced</option>
          </Select>
        </Field>
      </Stack>
    );
  },
};

export const Invalide: Story = {
  name: "invalid",
  render: function Render() {
    const [value, setValue] = useState("");
    return (
      <Field label="Time zone" error="Choose a time zone.">
        <Select value={value} onChange={(e) => setValue(e.target.value)} invalid>
          <option value="paris">Paris</option>
          <option value="tokyo">Tokyo</option>
        </Select>
      </Field>
    );
  },
};
