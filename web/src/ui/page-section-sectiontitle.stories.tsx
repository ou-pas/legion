// The section heading carries the rule: two sections are separated by a line, not by white space.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { RefreshCw } from "lucide-react";
import { Button } from "./button.js";
import { Stack } from "./flex.js";
import { Page, Section, SectionTitle } from "./page.js";

const meta = { title: "ui / Section / SectionTitle" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithCount: Story = {
  name: "with counter",
  render: () => {
    return (
      <Stack gap={10}>
        <Page>
          <Section title="Needs you" count={2} />
          <Section
            title="Running sessions"
            count={3}
            actions={
              <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />}>
                Refresh
              </Button>
            }
          >
            <div className="dsl-quiet">3 sessions on home-server, the oldest since 2h14.</div>
          </Section>
        </Page>
      </Stack>
    );
  },
};

export const WithoutCount: Story = {
  name: "without counter",
  render: () => {
    return (
      <Stack gap={10}>
        <SectionTitle title="Goal guardrails" />
      </Stack>
    );
  },
};
