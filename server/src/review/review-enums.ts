// The two enumerations of a pre-review comment, read together: a comment is anchored on a side of
// the diff and has a status. The type comes from `review-store.ts`, not `shared/db.js`: this file
// holds rules and does not touch the database, not even through a type import.
import type { ReviewCommentRow } from "./review-store.js";

/** The diff side the comment is anchored on. `new` by default: we comment on what is proposed, not
 *  on what it replaces. */
export type ReviewSide = ReviewCommentRow["side"];
export const REVIEW_SIDE = {
  old: "old",
  new: "new",
} as const satisfies Record<string, ReviewSide>;

/** Two values, not three: a comment is pending (`open`) or already handed to the agent (`sent`).
 *  There is no "resolved": the task's rerun answers, and the next comment judges.
 *
 *  `open` is spelled like an inbox entry status and has nothing to do with it, which is exactly why
 *  these values are named, and why the replacement was done per domain. */
export type ReviewCommentStatus = ReviewCommentRow["status"];
export const REVIEW_COMMENT_STATUS = {
  open: "open",
  sent: "sent",
} as const satisfies Record<string, ReviewCommentStatus>;
