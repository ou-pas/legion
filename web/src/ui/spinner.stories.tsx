import type { Meta, StoryObj } from "@storybook/react-vite";
import { Row } from "./flex.js";
import { Spinner } from "./spinner.js";

const meta = { title: "ui / Spinner" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const SmMdLg: Story = {
  name: "sm / md / lg",
  render: () => (
    <Row gap={10} wrap>
      <Spinner size="sm" label="Loading tasks…" />
      <Spinner size="md" label="Starting container legion-sess-8f2a…" />
      <Spinner size="lg" label="Cloning acme/checkout-web…" />
    </Row>
  ),
};

export const InATextLine: Story = {
  name: "in a line of text",
  render: () => (
    <Row gap={10} wrap>
      <Spinner size="sm" label="Starting container…" />
      <span className="dsf-quiet">Starting container legion-sess-8f2a on home-server…</span>
    </Row>
  ),
};
