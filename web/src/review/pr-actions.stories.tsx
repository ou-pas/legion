// The PR gesture bar (15/09). It sits in the PR view header and in the channel panel, so its
// states are judged HERE: the whole row must fit, repair buttons included.
//
// The component queries the forge itself: unseeded, the workshop shows the "not known yet" state,
// which no longer hides the open button (15/09), only changes its label.
import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useQueryClient } from "@tanstack/react-query";
import type { PrMergeState } from "../api/review.js";
import { PrActions } from "./pr-actions.js";

/** Same pattern as `task-verdict.stories.tsx` and `pr-tab.stories.tsx`: seed the cache key
 *  `prMergeStatesQuery` reads, to show a chosen state rather than "not known yet" every time. */
function SeedMergeStates({
  taskId,
  states,
  children,
}: {
  taskId: string;
  states: PrMergeState[];
  children: ReactNode;
}) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.setQueryData(["pr-merge-state", taskId], states);
  }, [qc, taskId, states]);
  return <>{children}</>;
}

const meta = { title: "review / PR actions (PrActions)" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};
const PR = [{ repo: "legion", url: "https://github.com/ou-pas/legion/pull/42" }];
const DEUX = [...PR, { repo: "front", url: "https://github.com/ou-pas/front/pull/7" }];

export const WithoutPush: Story = {
  name: "no push, no PR — nothing to open",
  render: () => <PrActions taskId="t1" prUrls={[]} pushedCode={false} onCreated={noop} />,
};

export const None: Story = {
  name: "code pushed, no PR — one action, open it",
  render: () => <PrActions taskId="t1" prUrls={[]} pushedCode onCreated={noop} />,
};

export const UnknownState: Story = {
  name: "one PR, state not known yet — the mark, and the action stays offered",
  render: () => <PrActions taskId="t1" prUrls={PR} pushedCode onCreated={noop} />,
};

export const OpenPr: Story = {
  name: 'PR open — the mark, and "Recreate / find" for catch-up',
  render: function Render() {
    return (
      <SeedMergeStates
        taskId="t1"
        states={[
          { repo: "legion", url: PR[0]!.url, number: 42, mergeState: "mergeable", prState: "open" },
        ]}
      >
        <PrActions taskId="t1" prUrls={PR} pushedCode onCreated={noop} />
      </SeedMergeStates>
    );
  },
};

export const ClosedPr: Story = {
  name: "PR closed — the same button, which reopens instead of finding",
  render: function Render() {
    return (
      <SeedMergeStates
        taskId="t1"
        states={[
          { repo: "legion", url: PR[0]!.url, number: 42, mergeState: "unknown", prState: "closed" },
        ]}
      >
        <PrActions taskId="t1" prUrls={PR} pushedCode onCreated={noop} />
      </SeedMergeStates>
    );
  },
};

export const TwoPrs: Story = {
  name: "two repos — each mark carries its name",
  render: () => <PrActions taskId="t1" prUrls={DEUX} pushedCode onCreated={noop} />,
};

export const WithChild: Story = {
  name: "with a child — the channel slips in its link to the diff",
  render: () => (
    <PrActions taskId="t1" prUrls={[]} pushedCode onCreated={noop}>
      <a href="#">Diff and PR draft</a>
    </PrActions>
  ),
};

// The busiest row: open, mark, conflict resolution and CI fix side by side. It tells whether the
// bar fits in a header; the other states fit anyway.
export const EverythingToRepair: Story = {
  name: "conflict and red CI — the whole row, as a header receives it",
  render: function Render() {
    return (
      <SeedMergeStates
        taskId="t-repair"
        states={[
          {
            repo: "legion",
            url: PR[0]!.url,
            number: 42,
            mergeState: "conflict",
            prState: "open",
            checkState: "failing",
          },
        ]}
      >
        <PrActions taskId="t-repair" prUrls={PR} pushedCode onCreated={noop} />
      </SeedMergeStates>
    );
  },
};
