// The pre-review: a task branch's diff and the comments on it. Its failure states are NOT screen
// failures: a branch never pushed to a repo (`files: null` without error), a repo whose read
// failed, a patch omitted by the forge. They look alike in code and read very differently;
// seeing them apart is the only way to check each states its cause.
//
// The state that matters most is the USEFUL EMPTY: nothing to review because the branch changed
// nothing. It must not look like a loading that never ends.
import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { REVIEW_COMMENT_STATUS, type ReviewComment, type TaskDiffDto } from "../api/review.js";
import { DiffView } from "./diff-view.js";

const meta = { title: "review / DiffView" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const TASK_ID = "t-1";
const PATH = "web/src/tasks/quick-task-modal.tsx";

const PATCH = `@@ -70,9 +70,12 @@ export function QuickTaskModal({
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

const diff = (over: Partial<TaskDiffDto> = {}): TaskDiffDto => ({
  branch: "legion/quick-task-modal",
  repos: [
    {
      repo: "legion",
      branch: "legion/quick-task-modal",
      error: null,
      files: [
        { path: PATH, status: "modified", additions: 6, deletions: 2, patch: PATCH },
        {
          path: "web/src/tasks/text/quick-task.ts",
          status: "added",
          additions: 24,
          deletions: 0,
          patch: PATCH,
        },
        {
          path: "browser-image/chrome.tar.gz",
          status: "added",
          additions: 0,
          deletions: 0,
          patch: null,
        },
      ],
    },
  ],
  ...over,
});

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "c-1",
  taskId: TASK_ID,
  repoName: "legion",
  filePath: PATH,
  line: 76,
  side: "new",
  startLine: null,
  excerpt: "        externalRef,",
  body: "Check that a missing `branch` doesn't become `undefined` in the JSON sent.",
  status: REVIEW_COMMENT_STATUS.open,
  createdAt: "2026-09-06T10:00:00.000Z",
  sentAt: null,
  ...over,
});

function withDiff(data: TaskDiffDto, comments: ReviewComment[], children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: () => new Promise(() => {}) } },
  });
  qc.setQueryData(["task-diff", TASK_ID], data);
  qc.setQueryData(["review-comments", TASK_ID], comments);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

export const ThreeFiles: Story = {
  name: "three files — the card on the left, the files collapsed on the right",
  render: () => withDiff(diff(), [], <DiffView taskId={TASK_ID} />),
};

export const WithComments: Story = {
  name: "two open comments — the card's footer counts what will go out",
  render: () =>
    withDiff(
      diff(),
      [
        comment(),
        comment({
          id: "c-2",
          line: 79,
          body: "The refusal message must name the created task, not just the error.",
        }),
      ],
      <DiffView taskId={TASK_ID} />,
    ),
};

export const CommentAlreadySent: Story = {
  name: "a comment already sent to the agent — it no longer counts toward what's left to send",
  render: () =>
    withDiff(
      diff(),
      [comment({ status: REVIEW_COMMENT_STATUS.sent, sentAt: "2026-09-06T10:05:00.000Z" })],
      <DiffView taskId={TASK_ID} />,
    ),
};

export const BranchNeverPushed: Story = {
  name: "branch never pushed on this repo — `files: null` WITHOUT an error, and it's not a failure",
  render: () =>
    withDiff(
      diff({
        repos: [{ repo: "api", branch: "legion/quick-task-modal", files: null, error: null }],
      }),
      [],
      <DiffView taskId={TASK_ID} />,
    ),
};

export const ReadFailed: Story = {
  name: "reading the repo failed — the cause is written, not guessed",
  render: () =>
    withDiff(
      diff({
        repos: [
          {
            repo: "api",
            branch: "legion/quick-task-modal",
            files: null,
            error: "GITHUB_TOKEN doesn't cover x/api (404)",
          },
        ],
      }),
      [],
      <DiffView taskId={TASK_ID} />,
    ),
};

export const NoChange: Story = {
  name: "the branch changed nothing — a useful empty state, not a load that never finishes",
  render: () =>
    withDiff(
      diff({
        repos: [{ repo: "legion", branch: "legion/quick-task-modal", files: [], error: null }],
      }),
      [],
      <DiffView taskId={TASK_ID} />,
    ),
};

export const TwoRepos: Story = {
  name: "a cross-repo feature — two repos on the same branch, in the same card",
  render: () =>
    withDiff(
      diff({
        repos: [
          ...diff().repos,
          {
            repo: "api",
            branch: "legion/quick-task-modal",
            error: null,
            files: [
              {
                path: "server/src/tasks/routes.ts",
                status: "modified",
                additions: 3,
                deletions: 1,
                patch: PATCH,
              },
            ],
          },
        ],
      }),
      [],
      <DiffView taskId={TASK_ID} />,
    ),
};
