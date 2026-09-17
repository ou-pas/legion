// The table of contents of a review: with forty-eight collapsed files, one must know where to go
// BEFORE expanding. Two behaviours only show on a real tree: single-child folders are COMPACTED
// on one line (`web/src/review` rather than three empty levels), and the last expanded file is
// marked, or one loses one's place when scrolling back up.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Caption } from "../ui/text.js";
import { DiffTree } from "./diff-tree.js";
import type { TreeDir, TreeFile, TreeNode } from "./file-tree.js";

const meta = { title: "review / DiffTree" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const file = (path: string, over: Partial<TreeFile> = {}): TreeFile => ({
  kind: "file",
  name: path.split("/").pop()!,
  path,
  repo: "legion",
  additions: 12,
  deletions: 3,
  comments: 0,
  ...over,
});

const dir = (name: string, path: string, children: TreeNode[]): TreeDir => ({
  kind: "dir",
  name,
  path,
  children,
});

const TREE: TreeNode[] = [
  dir("web/src/tasks", "web/src/tasks", [
    file("web/src/tasks/quick-task-modal.tsx", { additions: 119, deletions: 0 }),
    file("web/src/tasks/TaskPage.tsx", { additions: 18, deletions: 232, comments: 2 }),
    file("web/src/tasks/use-task-actions.tsx", { additions: 176, deletions: 0 }),
  ]),
  dir("web/src/projects", "web/src/projects", [
    file("web/src/projects/ProjectPage.tsx", { additions: 40, deletions: 501, comments: 1 }),
    file("web/src/projects/secrets-card.tsx", { additions: 173, deletions: 0 }),
  ]),
  file("Makefile", { name: "Makefile", additions: 4, deletions: 1 }),
];

const noop = () => {};
const OPEN = new Set(["web/src/tasks", "web/src/projects"]);

export const Expanded: Story = {
  name: "expanded — single-child folders are compacted onto one line",
  render: () => (
    <DiffTree nodes={TREE} openDirs={OPEN} current={null} onToggleDir={noop} onPick={noop} />
  ),
};

export const Collapsed: Story = {
  name: "collapsed — the card fits in three lines",
  render: () => (
    <DiffTree nodes={TREE} openDirs={new Set()} current={null} onToggleDir={noop} onPick={noop} />
  ),
};

export const CurrentFile: Story = {
  name: "a file expanded last — it's marked, otherwise you lose your place",
  render: () => (
    <DiffTree
      nodes={TREE}
      openDirs={OPEN}
      current="legion/web/src/tasks/TaskPage.tsx"
      onToggleDir={noop}
      onPick={noop}
    />
  ),
};

export const SingleOpenFolder: Story = {
  name: "only one folder open — the other stays counted without being read",
  render: () => (
    <DiffTree
      nodes={TREE}
      openDirs={new Set(["web/src/tasks"])}
      current={null}
      onToggleDir={noop}
      onPick={noop}
    />
  ),
};

export const WithFooter: Story = {
  name: "with its footer — what the page puts under the card",
  render: () => (
    <DiffTree
      nodes={TREE}
      openDirs={OPEN}
      current={null}
      onToggleDir={noop}
      onPick={noop}
      footer={<Caption>3 open comments</Caption>}
    />
  ),
};

export const Empty: Story = {
  name: "no file — the branch changed nothing",
  render: () => (
    <DiffTree nodes={[]} openDirs={new Set()} current={null} onToggleDir={noop} onPick={noop} />
  ),
};

export const DeepTree: Story = {
  name: "a deep tree — the indentation stays readable at the fourth level",
  render: () => (
    <DiffTree
      nodes={[
        dir("server/src", "server/src", [
          dir("sessions/runner", "server/src/sessions/runner", [
            file("server/src/sessions/runner/manager.ts", {
              additions: 340,
              deletions: 120,
              comments: 4,
            }),
            dir("payload", "server/src/sessions/runner/payload", [
              file("server/src/sessions/runner/payload/spec.ts", { additions: 8, deletions: 8 }),
            ]),
          ]),
        ]),
      ]}
      openDirs={
        new Set(["server/src", "server/src/sessions/runner", "server/src/sessions/runner/payload"])
      }
      current={null}
      onToggleDir={noop}
      onPick={noop}
    />
  ),
};
