// The global return banner (02/09) in its PURE form, like `StatusGroup` for the bar: no query,
// no QueryClient, no boot memory.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReturnedBanner } from "./update-return-banner.js";

const meta = { title: "infra / Return banner (ReturnedBanner)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

export const Nominal: Story = {
  name: "back with a new version — no automatic reload (#57)",
  render: () => <ReturnedBanner tag="v0.6.0" onReload={noop} onClose={noop} />,
};
