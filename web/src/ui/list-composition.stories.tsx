// A dashboard attention row as it will be rebuilt: List + StatusChip + Meter + Badge, without a
// single ad-hoc class. Checks the slice holds together.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox, Target } from "lucide-react";
import { Badge, StatusChip } from "./chip.js";
import { Stack } from "./flex.js";
import { List, ListItem } from "./list.js";

const meta = { title: "ui / Composition" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const RealAssembly: Story = {
  name: "real assembly",
  render: () => {
    return (
      <Stack gap={10}>
        <div className="dsd-sheet">
          <List>
            <ListItem
              as="a"
              href="#ds-composition"
              leading={<Target size={15} />}
              title="Stripe Checkout payment tunnel redesign"
              sub="approval gate — senior-dev has been waiting for 18 min"
              meta={
                <>
                  <StatusChip state="gate">needs approval</StatusChip>
                  <Badge count={2} tone="wait" label="2 questions" />
                </>
              }
            />
            <ListItem
              as="a"
              href="#ds-composition"
              leading={<Inbox size={15} />}
              title="PDF export of monthly reports"
              sub="senior-dev — blocking question"
              meta={<StatusChip state="wait">waiting for your answer</StatusChip>}
            />
          </List>
        </div>
      </Stack>
    );
  },
};
