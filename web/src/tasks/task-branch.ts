// A task's branch as the screen READS it (night review #9). Shared because several screens show
// it (task page, channel details).
//
// This module derives nothing (slice nav/15). The server fixes the branch at its first derivation
// and stores it on the task, precisely so that a rename does not move it: recomputing it here would
// change it under the operator's eyes while the work stays on the old one.
import { parseJsonOr } from "../api/json.js";
import type { Task } from "../api/tasks.js";

/** The task's branch, or `null` while none is fixed: a task never run has no branch, and inventing
 *  one would name something that does not exist.
 *
 *  `externalRef.branch` wins: a fix-up task pushes to the branch of ITS PR, which belongs to someone
 *  else. An unreadable external ref names no branch: fall back on the column instead of throwing
 *  while rendering the verdict, the PR tab and the channel view at once. */
export function taskBranch(task: Pick<Task, "externalRef" | "branch">): string | null {
  return parseJsonOr<{ branch?: string }>(task.externalRef, {}).branch ?? task.branch;
}
