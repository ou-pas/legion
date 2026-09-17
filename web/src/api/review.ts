import { json, post } from "./client.js";

/** Pre-review comment enums, mirror of `server/src/review/review-enums.ts`. `open` is spelled like
 *  an inbox item status and like a forge PR state: three families, three constants. */
export const REVIEW_SIDE = { old: "old", new: "new" } as const;
export type ReviewSide = (typeof REVIEW_SIDE)[keyof typeof REVIEW_SIDE];

export const REVIEW_COMMENT_STATUS = { open: "open", sent: "sent" } as const;
export type ReviewCommentStatus =
  (typeof REVIEW_COMMENT_STATUS)[keyof typeof REVIEW_COMMENT_STATUS];

/** A change request's state at the forge: EXTERNAL vocabulary, fixed by GitHub and GitLab. */
export const PR_STATE = { open: "open", merged: "merged", closed: "closed" } as const;
export type PrState = (typeof PR_STATE)[keyof typeof PR_STATE];

export type PrComment = {
  id: string;
  author: string;
  body: string;
  path: string | null;
  url: string;
  createdAt: string;
};

/** `"unknown"` covers TWO causes the screen never tells apart: the forge has not finished computing
 *  (GitHub returns `mergeable: null` meanwhile) or the read failed. Either way it is NOT mergeable,
 *  see `review/merge-state.ts`. */
export type MergeState = "mergeable" | "conflict" | "unknown";

export type OpenPr = {
  repo: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  comments: PrComment[];
  mergeState: MergeState;
};

/** CI checks of a change request. `"unknown"` means no usable probe, as in `MergeState`: neither
 *  green nor a reason to act. */
export type CheckState = "passing" | "failing" | "pending" | "unknown";

/** Merge state of ONE PR already attached to a task (`task.prUrls` stores `{repo, url}`, never a
 *  number: the server reparses `number` from the URL, `null` if it cannot).
 *  v26+: `prState` is the PR's real state at the forge.
 *  v34: `checkState` is ABSENT when CI was not probed (PR not open, or forge read failed). Absence
 *  means neither green, `"unknown"` nor `"pending"`. */
export type PrMergeState = {
  repo: string;
  url: string;
  number: number | null;
  mergeState: MergeState;
  prState?: "open" | "merged" | "closed";
  checkState?: CheckState;
};
export type DiffFileDto = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
};
export type RepoDiff = {
  repo: string;
  branch: string;
  /** null without error = the branch was never pushed to this repo. */
  files: DiffFileDto[] | null;
  error: string | null;
};
export type TaskDiffDto = { branch: string; repos: RepoDiff[] };
export type ReviewComment = {
  id: string;
  taskId: string;
  repoName: string;
  filePath: string;
  line: number;
  /** v33. A number alone designates nothing: removed line 74 and added line 74 are two lines. */
  side: "old" | "new";
  /** v33. First line of the range; `null` = single-line comment. */
  startLine: number | null;
  excerpt: string;
  body: string;
  status: "open" | "sent";
  createdAt: string;
  sentAt: string | null;
};

export const reviewApi = {
  // Pre-review (v32): diff, anchored comments, sending = relaunch.
  taskDiff: (taskId: string): Promise<TaskDiffDto> => fetch(`/api/tasks/${taskId}/diff`).then(json),
  reviewComments: (taskId: string): Promise<ReviewComment[]> =>
    fetch(`/api/tasks/${taskId}/review-comments`).then(json),
  addReviewComment: (
    taskId: string,
    body: {
      repoName: string;
      filePath: string;
      line: number;
      side: "old" | "new";
      startLine?: number | null;
      excerpt: string;
      body: string;
    },
  ): Promise<ReviewComment> => post(`/api/tasks/${taskId}/review-comments`, body),
  deleteReviewComment: (id: string) =>
    fetch(`/api/review-comments/${id}`, { method: "DELETE" }).then(json),
  sendReview: (taskId: string): Promise<{ launched: string; count: number }> =>
    post(`/api/tasks/${taskId}/review-send`),
  githubPrs: (projectId: string): Promise<OpenPr[]> =>
    fetch(`/api/github/prs?projectId=${projectId}`).then(json),
  createPr: (
    taskId: string,
  ): Promise<{ prs: { repo: string; url: string; existing?: boolean }[]; errors: string[] }> =>
    post(`/api/tasks/${taskId}/pr`),
  // Read on demand when the PR tab looks, never a background poller.
  prMergeStates: (taskId: string): Promise<PrMergeState[]> =>
    fetch(`/api/tasks/${taskId}/pr-merge-state`).then(json),
  // Relaunches a session on the SAME task, instructed to merge the default branch and resolve.
  resolveConflict: (
    taskId: string,
    target: { repoName: string; number: number },
  ): Promise<{ launched: string }> => post(`/api/tasks/${taskId}/resolve-conflict`, target),
  // Sibling of resolveConflict on the other probe (checkState). The server rereads the checks at
  // the forge before launching: a 409 does not mean the screen lied, only that CI stopped being
  // red by the time of the click.
  fixCi: (
    taskId: string,
    target: { repoName: string; number: number },
  ): Promise<{ launched: string }> => post(`/api/tasks/${taskId}/fix-ci`, target),
};
