// Only exists next to an open PR with `checkState: "failing"` (see pr-tab.tsx). `fixCi` is
// injected, same pattern as ConciergeButton: the waiting and refusal states show BY CLICKING in
// the workshop, without reaching the network.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FixCiButton } from "./fix-ci-button.js";

const meta = { title: "review / FixCiButton" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const launched = () => Promise.resolve({ launched: "queued" });
const pending = () => new Promise<{ launched: string }>(() => {}); // never resolves: "sending"
const noLongerRed = () =>
  Promise.reject(new Error("pull request #565's CI is no longer red — nothing to fix"));
const sessionAlive = () =>
  Promise.reject(
    new Error("a session is already working on this task (s-a1b2c3) — wait for it to finish"),
  );
const forgeSilent = () => Promise.reject(new Error("the forge didn't respond"));

export const Offered: Story = {
  name: "offered — the action and its explanation, before any click",
  render: () => <FixCiButton taskId="t-1" repo="legion" number={565} fixCi={launched} />,
};

export const Sending: Story = {
  name: 'sending (real — click "Fix CI"): the button carries its spinner',
  render: () => <FixCiButton taskId="t-1" repo="legion" number={565} fixCi={pending} />,
};

export const Refused409NoLongerRed: Story = {
  name: "409 refusal — the CI is no longer red (real — click): nothing to fix",
  render: () => <FixCiButton taskId="t-1" repo="legion" number={565} fixCi={noLongerRed} />,
};

export const Refused409LiveSession: Story = {
  name: "409 refusal — a session is already working on the task (real — click)",
  render: () => <FixCiButton taskId="t-1" repo="legion" number={565} fixCi={sessionAlive} />,
};

export const Refused502SilentForge: Story = {
  name: "502 refusal — the forge didn't respond (real — click)",
  render: () => <FixCiButton taskId="t-1" repo="legion" number={565} fixCi={forgeSilent} />,
};
