// What an agent may request on its own task.
//
// Moved out of `internal-routes.ts` (lot 11), where the rule lived in the route body. It is a
// BOUNDARY: the `/internal` port is the only place where an agent token writes a task status, and
// plan.md's invariant says an agent never finishes a gated task. A boundary is tested by calling
// it, not by reading the route applying it.
//
// Nothing here touches database, disk or network: the artifact contract (`missingArtifacts`) reads
// the run folder and so stays in the route, behind these refusals.
import { lotApprovalOnly } from "../chains/slices.js";
import { parseCriteria } from "../tasks/criteria.js";
import { TASK_STATUS } from "../tasks/lifecycle.js";

/** Five columns, not the whole row: what does not enter here cannot influence the decision, which
 *  keeps the test readable. */
export interface GatedTask {
  status: string;
  criteria: string | null;
  approvalGate: boolean;
  templateId: string | null;
  stepIndex: number | null;
}

/** The refusal spelled out, or `null` when the agent may request this status.
 *
 *  A step approving a batch only ends through that approval. The `approvalGate` flag would already
 *  refuse the agent, but with a message sending it to wait for the operator without saying what the
 *  operator must do: here it is the batch they approve, and that gesture ends the step. Hence the
 *  order: the most precise refusal first.
 *
 *  A task carrying criteria is a gated step. Its agent may request `doing` or `review`, nothing
 *  else: the operator judges the declared evidence criterion by criterion, and only they finish.
 *  Criteria carry the gate as well as `approvalGate`, so a task with criteria stays closed even if
 *  the flag was unticked by hand. */
export function agentStatusRefusal(task: GatedTask, status: string | undefined): string | null {
  if (status === TASK_STATUS.done) {
    const lotOnly = lotApprovalOnly(task);
    if (lotOnly) return lotOnly;
  }
  const criteria = parseCriteria(task.criteria);
  if (status && criteria) {
    if (status === TASK_STATUS.done)
      return "only the operator finishes this task: it carries criteria they judge. Leave it for review.";
    // From review, the agent does not relaunch itself: the task awaits a decision.
    if (task.status === TASK_STATUS.review && status === TASK_STATUS.doing)
      return "this task is waiting for the operator: from review, only they run it again or finish it";
  }
  if (status === TASK_STATUS.done && task.approvalGate)
    return "approval gate: only the human can mark this task done";
  return null;
}

/** From review, a review request is accepted WITHOUT EFFECT: the route returns `ok` without touching
 *  the row, re-emitting `task_status` or re-notifying the gate. An agent calling `review` in a loop
 *  must not ring the phone at every call.
 *
 *  Reserved to tasks with criteria, like the original behaviour: elsewhere, a review request from
 *  review remains a transition arbitrated by `tasks/lifecycle.ts`'s table. */
export function inertReviewRequest(task: GatedTask, status: string | undefined): boolean {
  return (
    parseCriteria(task.criteria) !== null &&
    task.status === TASK_STATUS.review &&
    status === TASK_STATUS.review
  );
}
