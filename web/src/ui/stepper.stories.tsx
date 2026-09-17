import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stepper } from "./stepper.js";

const meta = { title: "UI/Stepper" } satisfies Meta;
export default meta;
type Story = StoryObj;

/** A stateful story is a named function: an anonymous arrow is not a component for react-hooks. */
export const Integer: Story = {
  name: "integer — sessions from 1 to 16",
  render: function Render() {
    const [v, setV] = useState(2);
    return <Stepper value={v} min={1} max={16} label="Concurrent sessions" onChange={setV} />;
  },
};

export const Fractions: Story = {
  name: "fractions — CPU in steps of 0.25",
  render: function Render() {
    const [v, setV] = useState(1.5);
    return (
      <Stepper
        value={v}
        min={0.25}
        max={16}
        step={0.25}
        unit="core"
        label="CPU per session"
        onChange={setV}
      />
    );
  },
};

export const AtBounds: Story = {
  name: "at the boundary — the button for the impossible step disables",
  render: function Render() {
    const [v, setV] = useState(1);
    return <Stepper value={v} min={1} max={4} label="Cap" onChange={setV} />;
  },
};

export const Formatted: Story = {
  name: "formatted — the value goes through a formatter",
  render: function Render() {
    const [v, setV] = useState(4096);
    return (
      <Stepper
        value={v}
        min={512}
        max={8192}
        step={512}
        unit="MB"
        label="RAM"
        format={(n) => (n >= 1024 ? `${n / 1024} GB` : `${n} MB`)}
        onChange={setV}
      />
    );
  },
};
