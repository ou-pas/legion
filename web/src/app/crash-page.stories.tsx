// The two faces of the crash screen. Neither can be triggered on demand: the first asks for an
// update while a page is open, the second is a real bug.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CrashPage } from "./crash-page.js";

const meta = { title: "app / Crash screen (CrashPage)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

export const Stale: Story = {
  name: "stale screen — reloading is enough, and we can promise that",
  render: () => (
    <CrashPage error={new Error("Importing a module script failed.")} onReload={noop} />
  ),
};

export const Broken: Story = {
  name: "real crash — we don't promise, we say what it does",
  render: () => <CrashPage error={new Error("t.segments is undefined")} onReload={noop} />,
};

export const NoMessage: Story = {
  name: "an error without a message — no fallback opening onto emptiness",
  render: () => <CrashPage error={undefined} onReload={noop} />,
};
