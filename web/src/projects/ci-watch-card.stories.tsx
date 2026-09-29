import type { Meta, StoryObj } from "@storybook/react-vite";
import { CiWatchCard } from "./ci-watch-card.js";
import { demoProject } from "./project-fixture.js";

const meta = { title: "projects / CiWatchCard" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {
  name: "on — the project default",
  render: () => <CiWatchCard project={demoProject({ ciWatch: true })} />,
};

export const Off: Story = {
  name: "off — the operator opted out",
  render: () => <CiWatchCard project={demoProject({ ciWatch: false })} />,
};
