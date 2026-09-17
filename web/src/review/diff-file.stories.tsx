// One file of the pre-review diff. Three states only happen in production with a real diff at
// hand, and they decide whether the review is usable: a file whose patch GitHub OMITS (binary,
// too big), stated rather than guessed; a comment already SENT to the forge versus a local one;
// and a multi-line range being selected.
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseDiff, type HunkData } from "react-diff-view";
import { REVIEW_COMMENT_STATUS, type ReviewComment } from "../api/review.js";
import { DiffFile } from "./diff-file.js";

const meta = { title: "review / DiffFile" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const PATH = "web/src/tasks/quick-task-modal.tsx";

/** A unified patch parsed by the library exactly as the page parses the forge's response:
 *  hand-made `HunkData` would state what we believe of the format, not what it is. */
const PATCH = `diff --git a/${PATH} b/${PATH}
--- a/${PATH}
+++ b/${PATH}
@@ -70,9 +70,12 @@ export function QuickTaskModal({
       const task = await tasksApi.createTask({
         name: name.trim(),
-        description,
+        description: description.trim(),
         projectId: project.id,
         agentId: effectiveAgent,
         approvalGate: gate,
+        externalRef,
+        ...(runNow ? {} : { status: TASK_STATUS.later }),
       });
-      if (runNow) await tasksApi.runTask(task.id);
+      const refusal = runNow ? await launch(task.id) : null;
+      if (refusal) { setError(refusal); return; }
       onClose();
`;

const HUNKS: HunkData[] = parseDiff(PATCH)[0]?.hunks ?? [];

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "c-1",
  taskId: "t-1",
  repoName: "legion",
  filePath: PATH,
  line: 76,
  side: "new",
  startLine: null,
  excerpt: "        externalRef,",
  body: "The external reference goes out as-is: remember to check that a missing `branch` doesn't become `undefined` in the JSON.",
  status: REVIEW_COMMENT_STATUS.open,
  createdAt: "2026-09-06T10:00:00.000Z",
  sentAt: null,
  ...over,
});

const noop = () => {};

export const Collapsed: Story = {
  name: "collapsed — the default state: with 48 files, expanding everything drowns the review",
  render: () => (
    <DiffFile
      repo="legion"
      path={PATH}
      status="modified"
      additions={6}
      deletions={2}
      hunks={HUNKS}
      comments={[]}
      selection={null}
      open={false}
      onOpenChange={noop}
      onLineClick={noop}
      onDelete={noop}
    />
  ),
};

export const Expanded: Story = {
  name: "expanded — the diff, line by line",
  render: () => (
    <DiffFile
      repo="legion"
      path={PATH}
      status="modified"
      additions={6}
      deletions={2}
      hunks={HUNKS}
      comments={[]}
      selection={null}
      open
      onOpenChange={noop}
      onLineClick={noop}
      onDelete={noop}
    />
  ),
};

export const WithLocalComment: Story = {
  name: "a comment not sent yet — it lives under its line",
  render: () => (
    <DiffFile
      repo="legion"
      path={PATH}
      status="modified"
      additions={6}
      deletions={2}
      hunks={HUNKS}
      comments={[comment()]}
      selection={null}
      open
      onOpenChange={noop}
      onLineClick={noop}
      onDelete={noop}
    />
  ),
};

export const WithSentComment: Story = {
  name: "a comment already at the forge — it no longer deletes the same way",
  render: () => (
    <DiffFile
      repo="legion"
      path={PATH}
      status="modified"
      additions={6}
      deletions={2}
      hunks={HUNKS}
      comments={[
        comment({ status: REVIEW_COMMENT_STATUS.sent, sentAt: "2026-09-06T10:05:00.000Z" }),
      ]}
      selection={null}
      open
      onOpenChange={noop}
      onLineClick={noop}
      onDelete={noop}
    />
  ),
};

export const SelectedRange: Story = {
  name: "a multi-line range being selected",
  render: () => (
    <DiffFile
      repo="legion"
      path={PATH}
      status="modified"
      additions={6}
      deletions={2}
      hunks={HUNKS}
      comments={[]}
      selection={{ repo: "legion", path: PATH, side: "new", from: 75, to: 77 }}
      open
      onOpenChange={noop}
      onLineClick={noop}
      onDelete={noop}
    />
  ),
};

export const OmittedPatch: Story = {
  name: "patch omitted by the forge — binary or too large, STATED and not guessed",
  render: () => (
    <DiffFile
      repo="legion"
      path="browser-image/chrome.tar.gz"
      status="added"
      additions={0}
      deletions={0}
      hunks={null}
      comments={[]}
      selection={null}
      open
      onOpenChange={noop}
      onLineClick={noop}
      onDelete={noop}
    />
  ),
};

export const DeletedFile: Story = {
  name: "a deleted file — the count is all that's left of it",
  render: () => (
    <DiffFile
      repo="legion"
      path="web/src/ui/theme.css"
      status="removed"
      additions={0}
      deletions={412}
      hunks={null}
      comments={[]}
      selection={null}
      open={false}
      onOpenChange={noop}
      onLineClick={noop}
      onDelete={noop}
    />
  ),
};
