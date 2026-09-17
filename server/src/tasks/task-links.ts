// Lineage between tasks (25/08, operator request: "I think one of them created another task").
//
// Recorded since batch 45: `propose_task` writes `proposedFromTaskId` on the filed task. Four pairs
// already existed in the database, none ever visible on screen. This module creates nothing, it
// reveals: a task says where it comes from, and what it spawned.
//
// Why a separate route rather than a `serializeTask` field: the serialiser also serves the board
// list. Computing children there would make a query per card, eighty on a loaded board, for
// information only the task page shows.
//
// Raw queries live in `task-links-store.ts`; this file assembles (resolved agent, derived
// `blocksParent`) and holds the two rules reading an already built `TaskLinks`.
import { TASK_STATUS } from "./lifecycle.js";
import { blockersOf } from "./blockers.js";
import {
  agentRowById,
  agentRowByProjectAndName,
  childrenOf,
  taskRowById,
  type TaskRow,
} from "./task-links-store.js";

/** A task seen from its parent or child: enough to show it and decide what to do with it, without
 *  asking the API again for each line. */
export interface TaskLink {
  id: string;
  name: string;
  status: string;
  /** The agent actually assigned. `null` on an agent-filed task: `propose_task` never assigns one,
   *  a guarantee of batch 45, not an oversight. */
  agentName: string | null;
  /** The name the agent suggested when filing the task. Free text validated on write. */
  suggestedAgentName: string | null;
  /** That suggested agent's id, if it still exists in the project. It makes the action possible in
   *  one gesture: without an assigned agent, moving a task to `todo` puts it in a queue where its
   *  launch will fail. Resolved here, where the project lives; the client does not guess. */
  suggestedAgentId: string | null;
  /** This lineage is a dependency, not just an extra: the parent is blocked by the child
   *  (`propose_task({ blocking: true })`, 25/08). True on both sides of the link, carrying the same
   *  sentence, "the parent waits for the child". What changes is who reads it: on the parent's page,
   *  "I am not finished"; on the child's, "someone is waiting for me". */
  blocksParent: boolean;
}

export interface TaskLinks {
  /** The task during whose session this one was filed. */
  parent: TaskLink | null;
  /** Tasks filed during this one's sessions, newest first. */
  children: TaskLink[];
}

function toLink(row: TaskRow, blocksParent = false): TaskLink {
  const agent = row.assigneeAgentId ? agentRowById(row.assigneeAgentId) : null;
  const suggested = row.proposedAgentName
    ? agentRowByProjectAndName(row.projectId, row.proposedAgentName)
    : null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    agentName: agent?.name ?? null,
    suggestedAgentName: row.proposedAgentName ?? null,
    suggestedAgentId: suggested?.id ?? null,
    blocksParent,
  };
}

export function taskLinks(taskId: string): TaskLinks {
  const task = taskRowById(taskId);
  if (!task) return { parent: null, children: [] };

  const parentRow = task.proposedFromTaskId ? taskRowById(task.proposedFromTaskId) : null;

  // Archived tasks stay in the lineage: an archived task still spawned the next one, and hiding the
  // link would rewrite history. Its status says so.
  const children = childrenOf(taskId);

  const blockers = new Set(blockersOf(task.id));
  return {
    // Seen from the child: does the parent wait for this task? The same fact as below, read from the
    // other end.
    parent: parentRow ? toLink(parentRow, blockersOf(parentRow.id).includes(task.id)) : null,
    // Seen from the parent: which children block it? Several, since `propose_task` adds a link
    // instead of refusing the second one (v45).
    children: children.map((c) => toLink(c, blockers.has(c.id))),
  };
}

/** Children still sleeping in `later`. What we recall when approving the parent: closing a piece of
 *  work is exactly where one remembers what it left behind. */
export function pendingChildren(links: TaskLinks): TaskLink[] {
  return links.children.filter((c) => c.status === TASK_STATUS.later);
}

/** The unmet prerequisite: the child blocking this task that is not finished.
 *
 *  The only thing opposed to an approval, and it comes from a real case: on 25/08 the Environments
 *  screen went `done` while the task filed during its session said "no server route exists for
 *  /api/environments". The shipped screen talks to routes that do not exist. Approving stays
 *  possible (the operator decides), but no longer by distraction. */
export function unmetPrerequisite(links: TaskLinks): TaskLink | null {
  return links.children.find((c) => c.blocksParent && c.status !== TASK_STATUS.done) ?? null;
}
