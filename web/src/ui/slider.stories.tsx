import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SnapSlider } from "./slider.js";

const meta = { title: "UI/SnapSlider" } satisfies Meta;
export default meta;
type Story = StoryObj;

const RAM_STOPS = [512, 1024, 2048, 4096, 8192, 16_384, 32_768] as const;
const fmtRam = (n: number) => (n >= 1024 ? `${n / 1024} GB` : `${n} MB`);

export const Steps: Story = {
  name: "steps — RAM on its powers of two",
  render: function Render() {
    const [v, setV] = useState(4096);
    return (
      <SnapSlider
        value={v}
        stops={RAM_STOPS}
        label="RAM per session"
        format={fmtRam}
        onChange={setV}
      />
    );
  },
};

export const OffSteps: Story = {
  name: "value off the steps — inserted into the scale, never overwritten",
  render: function Render() {
    const [v, setV] = useState(3072);
    return (
      <SnapSlider
        value={v}
        stops={RAM_STOPS}
        label="RAM per session"
        format={fmtRam}
        onChange={setV}
      />
    );
  },
};

export const AtFloor: Story = {
  name: "at the floor — the handle sticks to the left",
  render: function Render() {
    const [v, setV] = useState(512);
    return (
      <SnapSlider
        value={v}
        stops={RAM_STOPS}
        label="RAM per session"
        format={fmtRam}
        onChange={setV}
      />
    );
  },
};
