// What is stopped, project by project (slice nav/02).
//
// The icon rail's per-project badge counts what is stopped, never what is unread: "a counter that
// never goes down stops being looked at".
//
// Two things stop someone:
//   - an open inbox entry: an agent waits for an answer, its session sleeps;
//   - a task with an approval gate in review: nothing moves until the human decides.
//
// A notice does not count: it stops no session.
//
// Based on `open`, not a `blocking` column (there is none): `createInboxMessage` inserts an
// informational question directly as `closed` (inbox.ts).
//
// Open is not enough; someone must have to decide (slice nav/11). Waiting for another task
// (`waitForTaskId`, v26) and out-of-quota sleep (`wakeAt`, v28) wake on their own, and counting
// them made the badge rise on waits the operator cannot clear.
import {
  allProjectIds,
  openInboxRows,
  reviewGateProjectIds,
  type OpenInboxRow,
} from "./pending-by-project-store.js";

/** A count per project id. Every project is present, at zero if nothing waits, so a caller can
 *  tell "nothing pending" from "unknown project". */
export type PendingByProject = Record<string, number>;

/** Someone must have to decide (nav/11): `waitForTaskId` and `wakeAt` entries wake on their own. */
const stopsSomeone = (row: OpenInboxRow): boolean => !row.waitForTaskId && !row.wakeAt;

/** Pure count per project from rows already read. No dedup per task on purpose: answering a
 *  question and approving a gate are two decisions. */
export function countPendingByProject(
  projectIds: string[],
  openRows: OpenInboxRow[],
  gateProjectIds: string[],
): PendingByProject {
  const counts: PendingByProject = {};
  for (const id of projectIds) counts[id] = 0;
  for (const projectId of [
    ...openRows.filter(stopsSomeone).map((r) => r.projectId),
    ...gateProjectIds,
  ])
    counts[projectId] = (counts[projectId] ?? 0) + 1;
  return counts;
}

export function pendingByProject(): PendingByProject {
  return countPendingByProject(allProjectIds(), openInboxRows(), reviewGateProjectIds());
}
