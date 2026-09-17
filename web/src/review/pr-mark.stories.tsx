// Five looks for one component, and the rule choosing them is not linear: the PR state wins over
// the merge state (a merged PR has no conflict any more), and unknown is drawn OPEN because that
// is what the PR was last time we looked. Side by side is the only way to check they stay
// distinguishable at fifteen pixels.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PR_STATE } from "../api/review.js";
import { Row } from "../ui/flex.js";
import { PrMark } from "./pr-mark.js";

const meta = { title: "review / PrMark" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const URL = "https://github.com/x/legion/pull/64";

export const OpenPr: Story = {
  name: "open — the common case",
  render: () => <PrMark url={URL} state={PR_STATE.open} mergeState="mergeable" />,
};

export const Merged: Story = {
  name: "merged — the icon changes, not just the color",
  render: () => <PrMark url={URL} state={PR_STATE.merged} />,
};

export const ClosedPr: Story = {
  name: "closed without merging — a decision, not a failure",
  render: () => <PrMark url={URL} state={PR_STATE.closed} />,
};

export const InConflict: Story = {
  name: "in conflict — the branch no longer applies",
  render: () => <PrMark url={URL} state={PR_STATE.open} mergeState="conflict" />,
};

export const MergedDespiteConflict: Story = {
  name: 'merged and "conflict" — the PR state takes precedence, the conflict no longer exists',
  render: () => <PrMark url={URL} state={PR_STATE.merged} mergeState="conflict" />,
};

export const UnknownState: Story = {
  name: "the forge didn't respond — drawn open, that's what it was",
  render: () => <PrMark url={URL} />,
};

export const NumberReadFromUrl: Story = {
  name: "no number provided — it's read back from the address",
  render: () => <PrMark url="https://gitlab.com/x/legion/-/merge_requests/128" />,
};

export const UrlWithoutNumber: Story = {
  name: "an address that yields no number — the mark stays clickable",
  render: () => <PrMark url="https://github.com/x/legion/pulls" />,
};

export const SeveralRepos: Story = {
  name: "a task that pushes two repos — the name is then the only thing that tells them apart",
  render: () => (
    <Row gap={8} wrap>
      <PrMark url={URL} number={64} repo="front" state={PR_STATE.open} mergeState="mergeable" />
      <PrMark
        url="https://github.com/x/api/pull/12"
        number={12}
        repo="api"
        state={PR_STATE.open}
        mergeState="conflict"
      />
    </Row>
  ),
};
