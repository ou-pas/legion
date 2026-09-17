// Three provenances that look alike and do not mean the same: attached to the task, just created,
// or already there before asking. It matters when clicking "Open the PR" lands on a PR that
// existed: without the label one believes one created it. Since v26 the forge's real state can
// replace this fixed label.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PR_STATE } from "../api/review.js";
import { Stack } from "../ui/flex.js";
import { PR_LINK_STATE, PrLink } from "./pr-link.js";

const meta = { title: "review / PrLink" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const URL = "https://github.com/x/legion/pull/64";

export const Attached: Story = {
  name: "attached to the task — the common case",
  render: () => <PrLink repo="legion" url={URL} />,
};

export const JustCreated: Story = {
  name: "created just now — the receipt for the action just taken",
  render: () => <PrLink repo="legion" url={URL} state={PR_LINK_STATE.created} />,
};

export const AlreadyThere: Story = {
  name: "it already existed — without this label, you'd think you created it",
  render: () => <PrLink repo="legion" url={URL} state={PR_LINK_STATE.existing} />,
};

export const RealStateMerged: Story = {
  name: 'the forge says "merged" — the real state replaces the frozen label',
  render: () => <PrLink repo="legion" url={URL} prState={PR_STATE.merged} />,
};

export const RealStateClosed: Story = {
  name: 'the forge says "closed" — an attached PR isn\'t necessarily alive',
  render: () => <PrLink repo="legion" url={URL} prState={PR_STATE.closed} />,
};

export const CrossRepos: Story = {
  name: "a cross-repo feature — one PR per repo, stacked",
  render: () => (
    <Stack gap={6}>
      <PrLink repo="front" url="https://github.com/x/front/pull/64" state={PR_LINK_STATE.created} />
      <PrLink repo="api" url="https://github.com/x/api/pull/12" state={PR_LINK_STATE.existing} />
    </Stack>
  ),
};

export const LongName: Story = {
  name: "a long repo name — the chip stays readable",
  render: () => (
    <PrLink
      repo="acme-ai-prediction-api"
      url="https://github.com/x/acme-ai-prediction-api/pull/573"
    />
  ),
};
