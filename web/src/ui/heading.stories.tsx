// The level picks the size on the scale; `as` picks the tag. One voice, Archivo, headings included
// (Fraunces removed on 08/09). The headers of `Card`, `Panel` and `Section` do NOT pick their tag:
// it comes from their depth (`ui/heading-level`), so a card in a page is an `h2` and the same card
// in a section an `h3`. The document outline stays continuous without the screen thinking about
// it; the `level` prop remains the escape hatch.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { Button } from "./button.js";
import { Stack } from "./flex.js";
import { Heading } from "./heading.js";

const meta = { title: "ui / Heading" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const LONG_TASK = "Hosted Stripe Checkout payment tunnel redesign with webhook migration";

export const Level1Page: Story = {
  name: "level 1 — page",
  render: () => {
    return (
      <Stack gap={10}>
        <Heading level={1} as="p">
          Stripe payment tunnel
        </Heading>
      </Stack>
    );
  },
};

export const Focusable: Story = {
  name: "focusable — the title receives focus programmatically, the ring is the app's",
  render: function Render() {
    // `Heading` exposes no ref: focus is set from the container, as the inbox questionnaire does on
    // every screen change (`.inbox-qz-title`).
    const box = useRef<HTMLDivElement>(null);
    return (
      <Stack gap={10} ref={box}>
        <Heading level={3} as="h3" focusable>
          And when the tool has several parameters?
        </Heading>
        <Button size="sm" onClick={() => box.current?.querySelector<HTMLElement>("h3")?.focus()}>
          Give focus to the title
        </Button>
      </Stack>
    );
  },
};

export const Level2Section: Story = {
  name: "level 2 — section",
  render: () => {
    return (
      <Stack gap={10}>
        <Heading level={2}>Running sessions</Heading>
      </Stack>
    );
  },
};

export const Level3Card: Story = {
  name: "level 3 — card",
  render: () => {
    return (
      <Stack gap={10}>
        <Heading level={3}>senior-dev's capabilities</Heading>
      </Stack>
    );
  },
};

export const Level4Block: Story = {
  name: "level 4 — block",
  render: () => {
    return (
      <Stack gap={10}>
        <Heading level={4}>Allowed MCP servers</Heading>
      </Stack>
    );
  },
};

export const AsH2Visual4: Story = {
  name: "as=h2, visual 4",
  render: () => {
    return (
      <Stack gap={10}>
        <Heading level={4} as="h2">
          Budget for the "webhook migration" goal
        </Heading>
      </Stack>
    );
  },
};

export const LongTitle: Story = {
  name: "long title",
  render: () => {
    return (
      <Stack gap={10}>
        <Heading level={2}>{LONG_TASK}</Heading>
      </Stack>
    );
  },
};
