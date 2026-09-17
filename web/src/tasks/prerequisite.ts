// The UNMET prerequisite, screen side: the child blocking this task that is not done yet. Read by
// the lineage panel, which states it, and the action bar, which makes approval a two-step gesture;
// one function so that the day "unmet" means something else there is one place to fix.
//
// Not a client-side rule: `blocksParent` is computed by the server (server/src/tasks/task-links.ts).
import { type TaskLink, type TaskLinks } from "../api/tasks.js";
import { TASK_STATUS } from "../api/tasks.js";

export function unmetPrerequisite(links: TaskLinks | undefined): TaskLink | null {
  return links?.children.find((c) => c.blocksParent && c.status !== TASK_STATUS.done) ?? null;
}
