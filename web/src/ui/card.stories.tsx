// A sheet laid on the board. Never a card inside a card: inside, use Inset or Divider.

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bot, FileDown, GitBranch, Network } from "lucide-react";
import { Button } from "./button.js";
import { Card, CardBody, CardDescription, CardHeader } from "./card.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / Card" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const IconTitleDescActions: Story = {
  name: "icon + title + desc + actions",
  render: () => {
    return (
      <Stack gap={10}>
        <Card
          icon={<GitBranch size={15} />}
          title="Project repos"
          desc={
            <>
              Each session clones the repos granted to its agent into{" "}
              <code>./repos/&lt;name&gt;</code>, all on the same branch <code>legion/checkout</code>
              .
            </>
          }
          actions={<Button size="sm">Add a repo</Button>}
        >
          <div className="dsl-quiet">acme/checkout-web · acme/checkout-api</div>
        </Card>
      </Stack>
    );
  },
};

export const LongTitleTruncates: Story = {
  name: "long title that must truncate",
  render: () => {
    return (
      <Stack gap={10}>
        <Card
          icon={<FileDown size={15} />}
          title={
            <span className="dsl-ellipsis">
              PDF export of monthly reports — multi-currency variant with a custom header per client
            </span>
          }
          actions={
            <Button size="sm" variant="ghost">
              Open
            </Button>
          }
        />
      </Stack>
    );
  },
};

export const PadFalseCardBody: Story = {
  name: "pad=false + CardBody",
  render: () => {
    return (
      <Stack gap={10}>
        <Card pad={false}>
          <CardHeader
            icon={<Bot size={15} />}
            title="senior-dev"
            actions={
              <Button size="sm" variant="ghost">
                Edit
              </Button>
            }
            className="dsl-card-head-pad"
          />
          <CardBody>
            <CardDescription>
              Implementation agent: docker access, checkout-* repos, MCP Linear read-only.
            </CardDescription>
            <div className="dsl-quiet">8 sessions this week · $12.40</div>
          </CardBody>
        </Card>
      </Stack>
    );
  },
};

export const Empty: Story = {
  name: "empty",
  render: () => {
    return (
      <Stack gap={10}>
        <Card icon={<Network size={15} />} title="MCP servers">
          <div className="dsl-empty">No MCP server declared for this project.</div>
        </Card>
      </Stack>
    );
  },
};
