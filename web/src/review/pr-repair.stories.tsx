// The component queries the forge itself: without a backend the PR state is UNKNOWN, and a
// gesture is never offered on uncertainty, so it renders nothing here, which is the behaviour to
// see. Hence the `renders-nothing` tag: the stories gate cannot tell a deliberate empty from an
// accidental one.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrRepair } from "./pr-repair.js";

const meta = { title: "review / PR repairs (PrRepair)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const PR = [{ repo: "legion", url: "https://github.com/ou-pas/legion/pull/42" }];

export const UnknownState: Story = {
  name: "unknown state — no action, and that's the rule",
  tags: ["renders-nothing"],
  render: () => <PrRepair taskId="t1" prUrls={PR} />,
};

export const NoPr: Story = {
  name: "no PR — nothing to repair",
  tags: ["renders-nothing"],
  render: () => <PrRepair taskId="t1" prUrls={[]} />,
};
