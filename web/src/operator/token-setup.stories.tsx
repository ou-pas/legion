import type { Meta, StoryObj } from "@storybook/react-vite";
import { TokenSetup } from "./token-setup.js";

const meta = { title: "operator / First launch (TokenSetup)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AtRest: Story = {
  name: "at rest — the two commands, then the same field as SignIn",
  render: () => <TokenSetup onSignIn={async () => {}} />,
};
