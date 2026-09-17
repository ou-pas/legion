// No navigation here: `render` receives the computed class, the page supplies its TanStack Router
// `<Link>`.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Code } from "./code.js";
import { Row } from "./flex.js";
import { Link } from "./link.js";
import { Text } from "./text.js";

const meta = { title: "ui / Link" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultLink: Story = {
  name: "default",
  render: () => (
    <Row gap={10} wrap>
      <Text tone="muted">
        Registries are managed in <Link href="#ds-link">Library</Link>.
      </Text>
    </Row>
  ),
};

export const Plain: Story = {
  name: "plain",
  render: () => (
    <Row gap={10} wrap>
      <Link variant="plain" href="#ds-link">
        <Code variant="bare">5f0be31</Code>
      </Link>
    </Row>
  ),
};

export const Inherit: Story = {
  name: "inherit",
  render: () => (
    <Row gap={10} wrap>
      <Text tone="muted">
        <Link variant="inherit" href="#ds-link">
          Fully clickable task row
        </Link>
      </Text>
    </Row>
  ),
};

export const Render: Story = {
  name: "render",
  render: () => (
    <Row gap={10} wrap>
      <Link
        render={(p) => (
          <a
            {...p}
            href="https://github.com/acme/front/pull/482"
            target="_blank"
            rel="noreferrer"
          />
        )}
      >
        PR #482 — Stripe webhooks
      </Link>
    </Row>
  ),
};
