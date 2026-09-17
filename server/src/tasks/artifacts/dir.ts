// Where a task's artifacts live on the control plane's disk.
//
// Moved out of the task routes (slice nav/12). Exported from the middle of the routes, the review
// domain imported it from a routes module; bearable while the only reader was another route, not
// once PR opening became automatic: `review/open-pr.ts` loads from a session's end of life, and
// pulling in the task routes assembly (runner, chains, purge) for a `path.join` was a steep price.
import path from "node:path";
import { projectRoot } from "../../projects/fs-acl.js";
import { artifactsPath } from "./scope.js";
import { taskWithProject, type TaskAndProject } from "./dir-store.js";

/** The task's artifacts folder and the task itself: both callers need both, and reading them
 *  separately would make two queries for one question. `null` when the task (or its project) does
 *  not exist: the caller's 404. */
export function taskArtifactsDir(
  taskId: string,
): { dir: string; task: TaskAndProject["task"] } | null {
  const found = taskWithProject(taskId);
  if (!found) return null;
  const { task, project } = found;
  return { dir: path.join(projectRoot(project.slug, project.fsRoot), artifactsPath(task)), task };
}
