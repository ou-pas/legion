// A chain run's flow: which tasks make it up, in what order, who waits for what. A chain is linear
// (step N+1 blocked by N, see `server/src/chains/templates.ts`), so this module sorts by
// `stepIndex`, nothing more. No dedicated server route: `templateRunId`/`stepIndex`/`blockedBy`
// already travel on every task of `GET /api/tasks`, which the board and the task page both load.
import type { TaskSummary } from "../api/tasks.js";

/** A run's tasks in step order. Summaries (02/09 cut): this view reads `tasksQuery`, never a step's
 *  brief, which is fetched separately (`ChainRunPage`). */
export function chainRunSteps(tasks: readonly TaskSummary[], runId: string): TaskSummary[] {
  return tasks
    .filter((t) => t.templateRunId === runId)
    .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
}

/** Who waits for this step to finish: the next step of the same chain while blocked, or a task
 *  outside the chain listing it as a blocker (`propose_task({ blocking: true })`). The link is
 *  consumed on `done` (`settleDone`, server), so a past step has nobody waiting: no status to
 *  recompute here. */
export function awaitedBy(allTasks: readonly TaskSummary[], stepId: string): TaskSummary[] {
  return allTasks.filter((t) => t.blockedBy.some((b) => b.id === stepId));
}
