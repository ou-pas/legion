import type { Meta, StoryObj } from "@storybook/react-vite";
import { Folder, LayoutGrid } from "lucide-react";
import { Breadcrumb, BreadcrumbItem } from "./breadcrumb.js";
import { Stack } from "./flex.js";

const meta = { title: "ui / Breadcrumb" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentPath: Story = {
  name: "current path",
  render: () => (
    <Stack gap={10}>
      <Breadcrumb>
        <BreadcrumbItem render={(p) => <a href="#ds-breadcrumb" {...p} />}>Projects</BreadcrumbItem>
        <BreadcrumbItem
          icon={<Folder size={13} />}
          render={(p) => <a href="#ds-breadcrumb" {...p} />}
        >
          Demo (mock)
        </BreadcrumbItem>
        <BreadcrumbItem icon={<LayoutGrid size={13} />}>Board</BreadcrumbItem>
      </Breadcrumb>
    </Stack>
  ),
};

export const TooLongMiddleCollapsed: Story = {
  name: "too long → middle collapsed",
  render: () => (
    <Stack gap={10}>
      <Breadcrumb>
        <BreadcrumbItem render={(p) => <a href="#ds-breadcrumb" {...p} />}>Projects</BreadcrumbItem>
        <BreadcrumbItem render={(p) => <a href="#ds-breadcrumb" {...p} />}>
          Demo (mock)
        </BreadcrumbItem>
        <BreadcrumbItem render={(p) => <a href="#ds-breadcrumb" {...p} />}>Reviews</BreadcrumbItem>
        <BreadcrumbItem render={(p) => <a href="#ds-breadcrumb" {...p} />}>
          front#412
        </BreadcrumbItem>
        <BreadcrumbItem>Stripe Checkout payment tunnel redesign</BreadcrumbItem>
      </Breadcrumb>
    </Stack>
  ),
};
